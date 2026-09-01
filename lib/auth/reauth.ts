import type { AuthContext } from '@/lib/auth/session';
import { ForbiddenError } from '@/lib/auth/rbac';
import { verifyPassword } from '@/lib/auth/password';
import { getUserById } from '@/lib/db/queries/users';
import { logAuditEvent } from '@/lib/audit/log';

/**
 * Re-verifies the CALLING admin's own current password before letting them
 * proceed with a "great concern" action — removing or hard-deleting an
 * employee, resetting a password, disabling/enabling an account, or a bulk
 * import. This is deliberately re-authentication of the admin performing
 * the action, not anything to do with the employee being acted on (which
 * is why it takes an AuthContext and a submitted password, nothing else).
 *
 * Reuses the exact same hash-verification call as the self-service
 * changePasswordAction (app/(app)/actions.ts) — no new crypto here. A wrong
 * password is audit-logged (ADMIN_REAUTH_FAILED, capturing which action was
 * attempted) before throwing, mirroring how PASSWORD_CHANGE_FAILED already
 * tracks a failed self-service attempt.
 */
export async function requireAdminReauth(
  ctx: AuthContext,
  submittedPassword: string,
  action: string,
): Promise<void> {
  const admin = await getUserById(ctx.userId);
  const isValid = submittedPassword ? await verifyPassword(admin.passwordHash, submittedPassword) : false;

  if (!isValid) {
    await logAuditEvent({
      action: 'ADMIN_REAUTH_FAILED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: action,
    });
    throw new ForbiddenError('Incorrect password.');
  }
}
