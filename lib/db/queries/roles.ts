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
 * out-of-range value avoids that.
 *
 * That temp value used to be a hardcoded -1, on the assumption real ranks
 * are always positive — false in practice: createRole (below) happily
 * creates roles below zero (an admin can shuffle a brand-new role all the
 * way to the bottom, past an existing rank-0 or negative one), and this
 * app has shipped with a real role permanently parked at hierarchyRank
 * -1 ("Associate"). Swapping that role (or anything adjacent to it once
 * another role also sits at -1) with the old hardcoded temp collided with
 * it immediately and threw. Using a temp value from the current
 * timestamp instead — a real rank landing on this exact number is not a
 * realistic concern — avoids the whole class of collision regardless of
 * how far into negative territory real ranks go.
 */
export async function swapRoleRanks(roleAId: string, roleBId: string) {
  const [a, b] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { id: roleAId } }),
    prisma.role.findUniqueOrThrow({ where: { id: roleBId } }),
  ]);
  const temp = -Date.now();

  await prisma.$transaction([
    prisma.role.update({ where: { id: a.id }, data: { hierarchyRank: temp } }),
    prisma.role.update({ where: { id: b.id }, data: { hierarchyRank: a.hierarchyRank } }),
    prisma.role.update({ where: { id: a.id }, data: { hierarchyRank: b.hierarchyRank } }),
  ]);
}

/**
 * Rename in place — the Hierarchy page originally shipped create/reorder/
 * toggle only, with no way to fix a role's name after the fact (see
 * deleteRole below for the same gap on removal). Same uniqueness
 * expectation as createRole, enforced the same way (the @unique
 * constraint on Role.name), surfaced as a friendly error rather than a
 * raw Prisma exception.
 */
export async function renameRole(roleId: string, name: string) {
  return prisma.role.update({ where: { id: roleId }, data: { name } });
}

/**
 * Deletes a role — only ever safe when zero employees currently hold it,
 * since User.roleId has no onDelete: SetNull (unlike the optional
 * createdBy/importBatch relations) — a role is load-bearing for every
 * user on it, so removing one out from under real accounts would be a
 * data-integrity break, not a convenience. Callers must check
 * countUsersWithRole first and surface a clear "N employees still have
 * this role" error instead of attempting the delete and letting Postgres
 * reject it.
 */
export async function countUsersWithRole(roleId: string): Promise<number> {
  return prisma.user.count({ where: { roleId } });
}

export async function deleteRole(roleId: string) {
  return prisma.role.delete({ where: { id: roleId } });
}
