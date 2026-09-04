import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

export type UsageScope = 'USER' | 'DEPARTMENT' | 'ORG';

// The fixed scopeId UsageScope.ORG rows always use — there is only ever
// one org, so this needs no real id the way a User/Department row does.
export const ORG_SCOPE_ID = 'org';

/** Today's UTC calendar day, truncated to midnight — the bucket key every UsageCounter row is keyed on. */
export function utcDayStart(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/**
 * The one function every quota check in this app ultimately calls — an
 * atomic "increment this counter, but only if it's still under the
 * limit" in a single round trip, so two concurrent requests can never
 * both slip through when only one slot remains (a plain read-then-write
 * would race: both reads could see "299 of 300", both writes would then
 * succeed, landing at 301). `INSERT ... ON CONFLICT ... DO UPDATE ...
 * WHERE` is the standard Postgres pattern for this: the UPDATE branch's
 * WHERE clause is evaluated against the CURRENT row before writing, so a
 * row already at the limit simply doesn't match and nothing is written —
 * `RETURNING` then comes back empty, which is exactly how a caller tells
 * "blocked" apart from "allowed and incremented."
 *
 * Must be called with a transaction client when it's one of several
 * checks that need to succeed or fail TOGETHER (see
 * lib/usage/limits.ts::checkAndConsumeUsage) — passing `prisma` itself
 * for a single standalone check is also fine.
 */
export async function atomicCheckAndIncrement(
  db: Prisma.TransactionClient | typeof prisma,
  scope: UsageScope,
  scopeId: string,
  limit: number,
): Promise<boolean> {
  const day = utcDayStart();
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "UsageCounter" (id, scope, "scopeId", day, count)
    VALUES (gen_random_uuid()::text, ${scope}::"UsageScope", ${scopeId}, ${day}::date, 1)
    ON CONFLICT (scope, "scopeId", day)
    DO UPDATE SET count = "UsageCounter".count + 1
    WHERE "UsageCounter".count < ${limit}
    RETURNING count
  `;
  return rows.length > 0;
}

/** Today's count for one (scope, scopeId) — used only to build a friendly "X of Y" message after a block. */
export async function readTodayCount(
  db: Prisma.TransactionClient | typeof prisma,
  scope: UsageScope,
  scopeId: string,
): Promise<number> {
  const day = utcDayStart();
  const row = await db.usageCounter.findUnique({
    where: { scope_scopeId_day: { scope, scopeId, day } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

/**
 * A user's effective daily limit: their own override if an admin set
 * one, otherwise their role's default — see both fields' own schema
 * comments. Always a real number; there is no "unlimited" path.
 */
export async function getEffectiveUserMessageLimit(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { dailyMessageLimitOverride: true, role: { select: { defaultDailyMessageLimit: true } } },
  });
  return user.dailyMessageLimitOverride ?? user.role.defaultDailyMessageLimit;
}

/** Every department (of the given ids) that actually has a limit configured — departments with no cap are skipped entirely, not treated as limit 0. */
export async function getDepartmentsWithLimits(
  departmentIds: string[],
): Promise<{ id: string; name: string; dailyMessageLimit: number }[]> {
  if (departmentIds.length === 0) return [];
  const rows = await prisma.department.findMany({
    where: { id: { in: departmentIds }, dailyMessageLimit: { not: null } },
    select: { id: true, name: true, dailyMessageLimit: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, dailyMessageLimit: r.dailyMessageLimit! }));
}

/** Fetches (creating with defaults on first use) the single org-wide usage policy row. */
export async function getOrgUsagePolicy() {
  return prisma.orgUsagePolicy.upsert({
    where: { id: 'org-usage-policy' },
    update: {},
    create: { id: 'org-usage-policy' },
  });
}

export async function updateOrgUsagePolicy(dailyMessageLimit: number, updatedById: string) {
  return prisma.orgUsagePolicy.upsert({
    where: { id: 'org-usage-policy' },
    update: { dailyMessageLimit, updatedById },
    create: { id: 'org-usage-policy', dailyMessageLimit, updatedById },
  });
}

/**
 * Today's usage dashboard for the admin Usage Limits page: every
 * employee and department with at least one message today, each next to
 * their configured limit, so an admin can see at a glance who's close to
 * (or already blocked by) their cap — the visibility half of this
 * feature, not just blind enforcement. Sorted by usage descending on
 * each list (the people/departments actually worth looking at first).
 */
export async function getTodayUsageSnapshot(): Promise<{
  org: { used: number; limit: number };
  users: { id: string; name: string; email: string; used: number; limit: number }[];
  departments: { id: string; name: string; used: number; limit: number }[];
}> {
  const day = utcDayStart();
  const [orgPolicy, userCounters, deptCounters] = await Promise.all([
    getOrgUsagePolicy(),
    prisma.usageCounter.findMany({ where: { scope: 'USER', day }, orderBy: { count: 'desc' } }),
    prisma.usageCounter.findMany({ where: { scope: 'DEPARTMENT', day }, orderBy: { count: 'desc' } }),
  ]);
  const orgCounter = await prisma.usageCounter.findUnique({
    where: { scope_scopeId_day: { scope: 'ORG', scopeId: ORG_SCOPE_ID, day } },
  });

  const userIds = userCounters.map((c) => c.scopeId);
  const deptIds = deptCounters.map((c) => c.scopeId);
  const [users, departments] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, dailyMessageLimitOverride: true, role: { select: { defaultDailyMessageLimit: true } } },
        })
      : [],
    deptIds.length
      ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true, dailyMessageLimit: true } })
      : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const deptById = new Map(departments.map((d) => [d.id, d]));

  return {
    org: { used: orgCounter?.count ?? 0, limit: orgPolicy.dailyMessageLimit },
    users: userCounters
      .map((c) => {
        const u = userById.get(c.scopeId);
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          used: c.count,
          limit: u.dailyMessageLimitOverride ?? u.role.defaultDailyMessageLimit,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    departments: deptCounters
      .map((c) => {
        const d = deptById.get(c.scopeId);
        if (!d || d.dailyMessageLimit === null) return null;
        return { id: d.id, name: d.name, used: c.count, limit: d.dailyMessageLimit };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  };
}
