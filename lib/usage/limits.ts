import { prisma } from '@/lib/db/prisma';
import {
  atomicCheckAndIncrement,
  readTodayCount,
  getEffectiveUserMessageLimit,
  getDepartmentsWithLimits,
  getOrgUsagePolicy,
  ORG_SCOPE_ID,
} from '@/lib/db/queries/usage';
import { logAuditEvent } from '@/lib/audit/log';

/**
 * Chat-message usage limiting — the mechanics a real company uses to make
 * sure an internal AI tool can never produce a surprise bill, at three
 * levels enforced together:
 *
 *   1. Per-employee (Role.defaultDailyMessageLimit, overridable per User)
 *   2. Per-department, optional (Department.dailyMessageLimit) — an
 *      aggregate budget across every member combined, a stricter
 *      cost-center control some departments opt into, layered on top of
 *      (never replacing) each member's own limit
 *   3. Org-wide (OrgUsagePolicy) — the final circuit breaker, independent
 *      of what any individual or department limit says
 *
 * Every level ALWAYS carries a real number — there is no "unlimited"
 * anywhere in this feature, by explicit design: the whole point is that
 * no single employee, department, or the org as a whole can ever run up
 * an unbounded AI bill, so nothing here is allowed to silently opt out of
 * having a ceiling.
 *
 * "No leakage" — the property that actually matters — comes from
 * checkAndConsumeUsage() running every applicable check inside ONE
 * Postgres transaction: if any single check fails, the whole transaction
 * rolls back, so a request that gets blocked never leaves a partial
 * "charge" against any counter, and two concurrent requests can never
 * both slip through when only one slot remains at any level (see
 * atomicCheckAndIncrement's own comment for the exact SQL pattern this
 * relies on). This is checked and consumed BEFORE the LLM is ever called
 * — a blocked request costs nothing, not even a wasted API call.
 */
export class UsageLimitExceededError extends Error {
  readonly scope: 'ORG' | 'DEPARTMENT' | 'USER';
  readonly limit: number;
  readonly used: number;

  constructor(scope: 'ORG' | 'DEPARTMENT' | 'USER', limit: number, used: number, departmentName?: string) {
    const messages = {
      ORG: `Ask Evon has reached its company-wide daily message limit (${limit}). This resets at midnight UTC — please try again tomorrow, or ask an admin to raise the limit in Admin → Usage Limits.`,
      DEPARTMENT: `${departmentName ?? 'Your department'} has reached its daily message limit (${limit}) for today. This resets at midnight UTC, or an admin can raise it in Admin → Usage Limits.`,
      USER: `You've reached your daily message limit (${limit}) for today. This resets at midnight UTC, or an admin can raise your limit in Admin → Employees.`,
    };
    super(messages[scope]);
    this.name = 'UsageLimitExceededError';
    this.scope = scope;
    this.limit = limit;
    this.used = used;
  }
}

/** A signal-only internal error used to unwind checkAndConsumeUsage's transaction with the details of which limit was hit — never thrown past this module. */
class UsageBlockedSignal extends Error {
  constructor(
    readonly scope: 'ORG' | 'DEPARTMENT' | 'USER',
    readonly scopeId: string,
    readonly limit: number,
    readonly departmentName?: string,
  ) {
    super('usage-blocked');
  }
}

/**
 * The one function every chat entry point calls before doing any real
 * work. Throws UsageLimitExceededError if blocked; returns normally
 * (having already incremented every applicable counter) if allowed.
 * Checked in order ORG → DEPARTMENT → USER, so if multiple limits happen
 * to be simultaneously exhausted, the broadest one (the company-wide
 * ceiling, the case most worth surfacing distinctly) is what the caller
 * sees — but ordering has no effect on correctness, since ANY failure
 * rolls back the whole transaction regardless of which check produced it.
 */
export async function checkAndConsumeUsage(ctx: { userId: string; departmentIds: string[] }): Promise<void> {
  const [orgPolicy, userLimit, departmentsWithLimits] = await Promise.all([
    getOrgUsagePolicy(),
    getEffectiveUserMessageLimit(ctx.userId),
    getDepartmentsWithLimits(ctx.departmentIds),
  ]);

  try {
    await prisma.$transaction(async (tx) => {
      const orgOk = await atomicCheckAndIncrement(tx, 'ORG', ORG_SCOPE_ID, orgPolicy.dailyMessageLimit);
      if (!orgOk) throw new UsageBlockedSignal('ORG', ORG_SCOPE_ID, orgPolicy.dailyMessageLimit);

      for (const dept of departmentsWithLimits) {
        const deptOk = await atomicCheckAndIncrement(tx, 'DEPARTMENT', dept.id, dept.dailyMessageLimit);
        if (!deptOk) throw new UsageBlockedSignal('DEPARTMENT', dept.id, dept.dailyMessageLimit, dept.name);
      }

      const userOk = await atomicCheckAndIncrement(tx, 'USER', ctx.userId, userLimit);
      if (!userOk) throw new UsageBlockedSignal('USER', ctx.userId, userLimit);
    });
  } catch (err) {
    if (err instanceof UsageBlockedSignal) {
      // Read-after-rollback: the blocked counter's CURRENT value, for a
      // "you've used X of Y" audit trail — a plain read, not part of the
      // transaction that just rolled back (nothing to roll back into).
      const used = await readTodayCount(prisma, err.scope, err.scopeId);
      await logAuditEvent({
        action: 'USAGE_LIMIT_EXCEEDED',
        result: 'DENIED',
        userId: ctx.userId,
        metadata: { scope: err.scope, limit: err.limit, used, departmentName: err.departmentName },
      });
      throw new UsageLimitExceededError(err.scope, err.limit, used, err.departmentName);
    }
    throw err;
  }
}
