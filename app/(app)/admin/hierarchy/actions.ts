'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import {
  listRolesByRankDesc,
  createRole,
  swapRoleRanks,
  renameRole,
  deleteRole,
  countUsersWithRole,
} from '@/lib/db/queries/roles';

export type ActionResult = { error?: string };

export async function createRoleAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Role name is required.' };

  try {
    const role = await createRole(name);
    await logAuditEvent({
      action: 'ROLE_CREATED',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: role.id,
      metadata: { name },
    });
  } catch {
    return { error: 'Could not create role — is that name already in use?' };
  }

  revalidatePath('/admin/hierarchy');
  return {};
}

export async function moveRoleAction(roleId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const roles = await listRolesByRankDesc(); // highest clearance first
  const index = roles.findIndex((r) => r.id === roleId);
  if (index === -1) return { error: 'Role not found.' };

  // "Up" in the displayed (desc-sorted) list means higher clearance, i.e.
  // swap with the previous entry; "down" swaps with the next entry.
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= roles.length) {
    return {}; // already at the top/bottom — no-op, not an error
  }

  await swapRoleRanks(roles[index].id, roles[swapIndex].id);
  await logAuditEvent({
    action: 'ROLE_HIERARCHY_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: roleId,
    metadata: {
      roleName: roles[index].name,
      direction,
      swappedWithRoleName: roles[swapIndex].name,
    },
  });

  revalidatePath('/admin/hierarchy');
  return {};
}

export async function renameRoleAction(roleId: string, name: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const trimmed = name.trim();
  if (!trimmed) return { error: 'Role name is required.' };

  const before = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  try {
    await renameRole(roleId, trimmed);
  } catch {
    return { error: 'Could not rename role — is that name already in use?' };
  }

  await logAuditEvent({
    action: 'ROLE_HIERARCHY_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: roleId,
    metadata: { field: 'name', oldValue: before.name, newValue: trimmed },
  });

  revalidatePath('/admin/hierarchy');
  return {};
}

/**
 * Only ever succeeds when zero employees currently hold this role (see
 * deleteRole's own comment) — used to retire a role that's no longer part
 * of the org chart, e.g. after every employee who held it has been
 * reassigned or removed. Clearance thresholds recorded on documents
 * (Document.clearanceLevel, an integer, not a foreign key to Role) are
 * untouched by this — a deleted role's old hierarchyRank number simply
 * stops appearing as a selectable option going forward.
 */
export async function deleteRoleAction(roleId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  const userCount = await countUsersWithRole(roleId);
  if (userCount > 0) {
    return { error: `${userCount} employee${userCount === 1 ? '' : 's'} still ${userCount === 1 ? 'has' : 'have'} this role — reassign or remove them first.` };
  }

  await deleteRole(roleId);
  await logAuditEvent({
    action: 'ROLE_HIERARCHY_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: roleId,
    metadata: { field: 'deleted', roleName: role.name },
  });

  revalidatePath('/admin/hierarchy');
  return {};
}

export async function toggleRoleCapabilityAction(
  roleId: string,
  field: 'canUploadDocuments' | 'isAdmin',
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  await prisma.role.update({ where: { id: roleId }, data: { [field]: !role[field] } });

  await logAuditEvent({
    action: 'ROLE_HIERARCHY_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: roleId,
    metadata: { roleName: role.name, field, newValue: !role[field] },
  });

  revalidatePath('/admin/hierarchy');
  return {};
}
