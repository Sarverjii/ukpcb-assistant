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

/**
 * Gates document MANAGEMENT (view in the knowledge base list, change
 * clearance, replace, delete) — distinct from requireCanUploadDocuments,
 * which only gates whether a role can upload at all. The knowledge base is
 * reachable by any canUploadDocuments role, not just admins (isAdmin stays
 * reserved for the employee/hierarchy/audit-log admin dashboard), so a
 * non-admin document manager needs its own ceiling: they can manage a
 * document only at or below their OWN clearance, exactly mirroring the
 * upload-time rule ("you cannot assign a clearance level above your own")
 * — otherwise a low-clearance uploader with canUploadDocuments could see or
 * delete documents their own role was never trusted to see the content of.
 * isAdmin bypasses this ceiling entirely — admins keep full oversight of
 * every document regardless of clearance, same as today.
 */
export function canManageDocument(ctx: AuthContext, documentClearanceLevel: number): boolean {
  return ctx.isAdmin || hasClearance(ctx.clearanceRank, documentClearanceLevel);
}

/**
 * Throws unless requireCanUploadDocuments passes AND (for a specific
 * existing document) canManageDocument passes. Pass `documentClearanceLevel:
 * undefined` for actions not yet scoped to one document (e.g. just loading
 * the knowledge base page, before any document is known).
 */
export async function requireCanManageDocument(
  ctx: AuthContext,
  documentClearanceLevel?: number,
): Promise<void> {
  await requireCanUploadDocuments(ctx);
  if (documentClearanceLevel !== undefined && !canManageDocument(ctx, documentClearanceLevel)) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: 'documents:manage',
      metadata: {
        roleName: ctx.roleName,
        clearanceRank: ctx.clearanceRank,
        documentClearanceLevel,
      },
    });
    throw new ForbiddenError('This document is above your clearance level.');
  }
}
