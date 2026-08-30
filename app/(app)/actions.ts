'use server';

import { signOut } from '@/lib/auth/auth.config';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { logAuditEvent } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { getUserById, updateUserPasswordHash } from '@/lib/db/queries/users';

export async function logoutAction() {
  try {
    const ctx = await getAuthContext();
    await logAuditEvent({ action: 'LOGOUT', result: 'SUCCESS', userId: ctx.userId });
  } catch (err) {
    if (!(err instanceof UnauthenticatedError)) throw err;
  }
  await signOut({ redirectTo: '/login' });
}

/**
 * Persists the theme choice to the user's account (not just this browser)
 * so it follows them anywhere they log in. The client applies the class to
 * <html> itself for instant feedback — this just makes it durable for next
 * time. Not audit-logged: a UI preference, not a security-relevant action.
 */
export async function updateThemePreferenceAction(theme: 'LIGHT' | 'DARK') {
  const ctx = await getAuthContext();
  await prisma.user.update({ where: { id: ctx.userId }, data: { themePreference: theme } });
}

export type ChangePasswordResult = { error?: string; success?: boolean };

/**
 * Self-service password change — distinct from the admin-initiated reset in
 * /admin/employees (that one is "I lost my password, an admin has to help
 * me"; this one is "I know my password and want a new one myself"). Only
 * ever acts on the caller's own account: getAuthContext() is the sole
 * source of userId here, never a client-supplied id, so there's no way to
 * pass someone else's account in.
 */
export async function changePasswordAction(formData: FormData): Promise<ChangePasswordResult> {
  const ctx = await getAuthContext();

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: 'All fields are required.' };
  }
  if (newPassword !== confirmPassword) {
    return { error: 'New password and confirmation do not match.' };
  }
  if (newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters.' };
  }

  const user = await getUserById(ctx.userId);
  const currentIsValid = await verifyPassword(user.passwordHash, currentPassword);
  if (!currentIsValid) {
    await logAuditEvent({
      action: 'PASSWORD_CHANGE_FAILED',
      result: 'ERROR',
      userId: ctx.userId,
      metadata: { reason: 'incorrect current password' },
    });
    return { error: 'Current password is incorrect.' };
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPasswordHash(ctx.userId, passwordHash);
  // Never log either plaintext password — only the fact that it changed.
  await logAuditEvent({ action: 'PASSWORD_CHANGED', result: 'SUCCESS', userId: ctx.userId });

  return { success: true };
}
