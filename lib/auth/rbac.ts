import type { AuthContext } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/audit/log';

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Capability check against a data-driven Role flag (Role.canUploadDocuments)
 * rather than an `if (role === 'CXO')` string comparison — so granting a
 * new role upload rights is a database update, not a code change.
 */
export async function requireCanUploadDocuments(ctx: AuthContext): Promise<void> {
  if (!ctx.canUploadDocuments) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: 'documents:upload',
      metadata: { roleName: ctx.roleName, clearanceRank: ctx.clearanceRank },
    });
    throw new ForbiddenError('Your role is not permitted to upload documents.');
  }
}

/**
 * Gates the admin dashboard (employee management, document management
 * actions, audit log viewing) — checked against the data-driven
 * Role.isAdmin flag, not a hardcoded role-name comparison.
 */
export async function requireAdmin(ctx: AuthContext): Promise<void> {
  if (!ctx.isAdmin) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: 'admin',
      metadata: { roleName: ctx.roleName, clearanceRank: ctx.clearanceRank },
    });
    throw new ForbiddenError('Your role does not have administrator access.');
  }
}

/**
 * Hierarchical clearance check: can a user at `userRank` see a resource
 * that requires `requiredRank`? Centralized here so "below" is defined in
 * exactly one place rather than reimplemented as `<=` comparisons scattered
 * through the app.
 */
export function hasClearance(userRank: number, requiredRank: number): boolean {
  return userRank >= requiredRank;
}
