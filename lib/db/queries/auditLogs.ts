import { prisma } from '@/lib/db/prisma';

const PAGE_SIZE = 50;

/**
 * Audit logs are themselves access-controlled (spec §19) — the only caller
 * of this function is the admin audit-log page, gated by requireAdmin().
 */
export async function listAuditLogs(page = 1) {
  const skip = (page - 1) * PAGE_SIZE;
  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  return { entries, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) };
}
