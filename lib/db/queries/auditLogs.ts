import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

const PAGE_SIZE = 50;

export type AuditLogEntry = {
  id: string;
  createdAt: Date;
  action: string;
  result: string;
  resource: string | null;
  metadata: Prisma.JsonValue;
  userName: string | null;
  userEmail: string | null;
};

export type AuditLogFilters = {
  action?: string;
  result?: string;
  /** Free-text search across the actor's name/email, resource id, and the
   * human-readable metadata captured at write time (documentName,
   * employeeName, etc.) — this is what makes "find everything touching
   * 'Julius'" or "what did Priya do" actually work, not just exact-id
   * lookups. */
  q?: string;
};

/**
 * Audit logs are themselves access-controlled (spec §19) — the only caller
 * of this function is the admin audit-log page, gated by requireAdmin().
 *
 * Raw SQL rather than the Prisma query builder: filtering needs to reach
 * into the metadata JSON blob (cast to text) and the joined user's name/
 * email in the same free-text search, which the ORM's typed JSON filters
 * don't cover in one query. Every filter value is still passed as a
 * parameterized argument ($1, $2, ...), not string-concatenated — this
 * stays injection-safe the same way every other raw query in this app is.
 */
export async function listAuditLogs(
  page = 1,
  filters: AuditLogFilters = {},
): Promise<{ entries: AuditLogEntry[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const skip = (page - 1) * PAGE_SIZE;

  const conditions: Prisma.Sql[] = [];
  if (filters.action) conditions.push(Prisma.sql`al.action = ${filters.action}`);
  if (filters.result) conditions.push(Prisma.sql`al.result = ${filters.result}`);
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    conditions.push(
      Prisma.sql`(u.name ILIKE ${like} OR u.email ILIKE ${like} OR al.resource ILIKE ${like} OR al.metadata::text ILIKE ${like})`,
    );
  }
  const whereClause = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  const [entries, totalRows] = await Promise.all([
    prisma.$queryRaw<AuditLogEntry[]>`
      SELECT al.id, al."createdAt", al.action, al.result, al.resource, al.metadata,
             u.name AS "userName", u.email AS "userEmail"
      FROM "AuditLog" al
      LEFT JOIN "User" u ON u.id = al."userId"
      ${whereClause}
      ORDER BY al."createdAt" DESC
      LIMIT ${PAGE_SIZE} OFFSET ${skip}
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM "AuditLog" al
      LEFT JOIN "User" u ON u.id = al."userId"
      ${whereClause}
    `,
  ]);

  const total = Number(totalRows[0]?.count ?? 0);
  return { entries, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) };
}

/** Distinct action values actually present in the log, for the filter dropdown — data-driven rather than a hardcoded list that could drift from AuditAction. */
export async function listDistinctAuditActions(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' },
  });
  return rows.map((r) => r.action);
}
