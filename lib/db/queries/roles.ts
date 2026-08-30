import { prisma } from '@/lib/db/prisma';

export function listRolesByRankDesc() {
  return prisma.role.findMany({ orderBy: { hierarchyRank: 'desc' } });
}

/**
 * New roles start at the BOTTOM of the hierarchy (lowest clearance) — the
 * admin then uses moveRoleUp/moveRoleDown to shuffle it into position. This
 * keeps "add" and "reorder" as two simple, separately-understandable
 * operations instead of one complex "insert at position N" form.
 */
export async function createRole(name: string) {
  const lowest = await prisma.role.findFirst({ orderBy: { hierarchyRank: 'asc' } });
  const newRank = (lowest?.hierarchyRank ?? 1) - 1;
  return prisma.role.create({
    data: { name, hierarchyRank: newRank, canUploadDocuments: false, isAdmin: false },
  });
}

/**
 * Swaps two roles' hierarchyRank (adjacent in the ordering, in practice —
 * that's what the up/down shuffle controls call). hierarchyRank is
 * @unique in the schema, and Postgres checks unique constraints
 * immediately after each statement (not deferred), so a direct two-way
 * swap would collide mid-transaction. Routing through a temporary
 * out-of-range value avoids that — safe because real ranks are always
 * positive (roles start at 1 and only grow from there or go through this
 * same swap), so -1 can never collide with a real rank.
 */
export async function swapRoleRanks(roleAId: string, roleBId: string) {
  const [a, b] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { id: roleAId } }),
    prisma.role.findUniqueOrThrow({ where: { id: roleBId } }),
  ]);

  await prisma.$transaction([
    prisma.role.update({ where: { id: a.id }, data: { hierarchyRank: -1 } }),
    prisma.role.update({ where: { id: b.id }, data: { hierarchyRank: a.hierarchyRank } }),
    prisma.role.update({ where: { id: a.id }, data: { hierarchyRank: b.hierarchyRank } }),
  ]);
}
