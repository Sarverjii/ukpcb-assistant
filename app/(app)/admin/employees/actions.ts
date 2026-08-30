'use server';

import { randomBytes } from 'crypto';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { hashPassword } from '@/lib/auth/password';
import { logAuditEvent } from '@/lib/audit/log';
import {
  createUser,
  updateUserRole,
  updateUserStatus,
  updateUserPasswordHash,
  getUserById,
} from '@/lib/db/queries/users';
import { revalidatePath } from 'next/cache';

export type ActionResult = { error?: string; tempPassword?: string };

export async function createEmployeeAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleId = String(formData.get('roleId') ?? '');
  const department = String(formData.get('department') ?? '').trim() || undefined;

  if (!name || !email || !roleId) {
    return { error: 'Name, email, and role are required.' };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await createUser({ name, email, passwordHash, roleId, department });
    await logAuditEvent({
      action: 'EMPLOYEE_CREATED',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: user.id,
      metadata: { email, roleId },
    });
  } catch {
    return { error: 'Could not create employee — is that email already in use?' };
  }

  revalidatePath('/admin/employees');
  return { tempPassword };
}

export async function changeEmployeeRoleAction(userId: string, roleId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  // Spec: users must not be able to modify their own role or clearance —
  // applies even to an admin acting on their own account, to prevent
  // accidental self-demotion/lockout.
  if (userId === ctx.userId) {
    return { error: 'You cannot change your own role.' };
  }

  await updateUserRole(userId, roleId);
  await logAuditEvent({
    action: 'EMPLOYEE_ROLE_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: { newRoleId: roleId },
  });
  revalidatePath('/admin/employees');
  return {};
}

export async function toggleEmployeeStatusAction(userId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (userId === ctx.userId) {
    return { error: 'You cannot disable your own account.' };
  }

  const user = await getUserById(userId);
  const nextStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  await updateUserStatus(userId, nextStatus);
  await logAuditEvent({
    action: 'EMPLOYEE_STATUS_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
    metadata: { newStatus: nextStatus },
  });
  revalidatePath('/admin/employees');
  return {};
}

export async function resetEmployeePasswordAction(userId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await updateUserPasswordHash(userId, passwordHash);
  // Never log the plaintext password itself — only the fact of the reset.
  await logAuditEvent({
    action: 'EMPLOYEE_PASSWORD_RESET',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: userId,
  });
  revalidatePath('/admin/employees');
  return { tempPassword };
}

function generateTempPassword(): string {
  return randomBytes(9).toString('base64url');
}
