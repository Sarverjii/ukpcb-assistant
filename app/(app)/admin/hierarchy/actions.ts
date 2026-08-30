'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { listRolesByRankDesc, createRole, swapRoleRanks } from '@/lib/db/queries/roles';

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
    metadata: { direction, swappedWith: roles[swapIndex].id },
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
    metadata: { field, newValue: !role[field] },
  });

  revalidatePath('/admin/hierarchy');
  return {};
}
