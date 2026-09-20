import { prisma } from '@/lib/db/prisma';
import {
  atomicCheckAndIncrement,
  readTodayCount,
  getEffectiveUserMessageLimit,
  getDepartmentsWithLimits,
  getOrgUsagePolicy,
  ORG_SCOPE_ID,
  PUBLIC_ORG_SCOPE_ID,
} from '@/lib/db/queries/usage';
import { logAuditEvent } from '@/lib/audit/log';

// The public chat's own per-visitor-IP daily cap — deliberately a fixed
// constant, not admin-configurable, unlike the org-wide public limit (see
// OrgUsagePolicy.publicDailyMessageLimit). This is a technical abuse-
// prevention valve (bound a single source's worst-case cost), not a cost
// lever an admin needs to tune the way the org-wide total is — the
// meaningful, auditable number to adjust is the total, in Admin → Usage
// Limits. 30/day comfortably covers a genuine visitor asking several real
// questions while still bounding what a single IP could cost even at its
// ceiling every day.
const PUBLIC_IP_DAILY_LIMIT = 30;

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
  readonly scope: 'ORG' | 'DEPARTMENT' | 'USER' | 'PUBLIC_ORG' | 'PUBLIC_IP';
  readonly limit: number;
  readonly used: number;

  constructor(
    scope: 'ORG' | 'DEPARTMENT' | 'USER' | 'PUBLIC_ORG' | 'PUBLIC_IP',
    limit: number,
    used: number,
    departmentName?: string,
  ) {
    const messages = {
      ORG: `UKPCB Assistant has reached its organization-wide daily message limit (${limit}). This resets at midnight UTC — please try again tomorrow, or ask an admin to raise the limit in Admin → Usage Limits.`,
      DEPARTMENT: `${departmentName ?? 'Your department'} has reached its daily message limit (${limit}) for today. This resets at midnight UTC, or an admin can raise it in Admin → Usage Limits.`,
      USER: `You've reached your daily message limit (${limit}) for today. This resets at midnight UTC, or an admin can raise your limit in Admin → Employees.`,
      PUBLIC_ORG: `This assistant has reached its daily limit (${limit}) for public questions. Please try again tomorrow.`,
      PUBLIC_IP: `You've reached today's limit (${limit}) for this chat. Please try again tomorrow.`,
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
    readonly scope: 'ORG' | 'DEPARTMENT' | 'USER' | 'PUBLIC_ORG' | 'PUBLIC_IP',
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

/**
 * The public chat's own entry point, called before any real work exactly
 * like checkAndConsumeUsage above — but against a completely separate pool
 * (see OrgUsagePolicy.publicDailyMessageLimit's own comment for why this
 * must never share a counter with employee usage). Two tiers, same
 * atomic-transaction "no leakage" guarantee: the org-wide public total
 * (admin-configurable), then a fixed per-visitor-IP cap
 * (PUBLIC_IP_DAILY_LIMIT) so no single source can exhaust the shared total
 * on its own. There is no per-user tier here — there is no user.
 */
export async function checkAndConsumePublicUsage(ip: string): Promise<void> {
  const orgPolicy = await getOrgUsagePolicy();

  try {
    await prisma.$transaction(async (tx) => {
      const orgOk = await atomicCheckAndIncrement(tx, 'PUBLIC_ORG', PUBLIC_ORG_SCOPE_ID, orgPolicy.publicDailyMessageLimit);
      if (!orgOk) throw new UsageBlockedSignal('PUBLIC_ORG', PUBLIC_ORG_SCOPE_ID, orgPolicy.publicDailyMessageLimit);

      const ipOk = await atomicCheckAndIncrement(tx, 'PUBLIC_IP', ip, PUBLIC_IP_DAILY_LIMIT);
      if (!ipOk) throw new UsageBlockedSignal('PUBLIC_IP', ip, PUBLIC_IP_DAILY_LIMIT);
    });
  } catch (err) {
    if (err instanceof UsageBlockedSignal) {
      const used = await readTodayCount(prisma, err.scope, err.scopeId);
      await logAuditEvent({
        action: 'USAGE_LIMIT_EXCEEDED',
        result: 'DENIED',
        metadata: { scope: err.scope, limit: err.limit, used, ip },
      });
      throw new UsageLimitExceededError(err.scope, err.limit, used);
    }
    throw err;
  }
}
