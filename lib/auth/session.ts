import { auth } from '@/lib/auth/auth.config';
import { prisma } from '@/lib/db/prisma';
import { getLoginSessionById, touchLoginSession } from '@/lib/db/queries/loginSessions';

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthenticatedError';
  }
}

export type AuthContext = {
  userId: string;
  name: string;
  email: string;
  roleName: string;
  clearanceRank: number;
  canUploadDocuments: boolean;
  isAdmin: boolean;
  // Every department this user belongs to (zero, one, several, or all) —
  // purely additive to clearanceRank, never a replacement for it. See
  // Department's schema.prisma comment and lib/db/queries/chunks.ts for the
  // resulting "clearance OR department" document-visibility rule.
  departmentIds: string[];
  // True if ANY of this user's departments is flagged isHeadDepartment —
  // grants visibility into every document tagged with ANY department
  // (not just this user's own), on top of the ordinary rule above. See
  // Department.isHeadDepartment's schema.prisma comment.
  hasHeadDepartmentAccess: boolean;
  themePreference: 'LIGHT' | 'DARK';
  // The current LoginSession's id — null for a token issued before this
  // feature existed (see the backward-compat note below). Lets Settings'
  // "Active sessions" list mark which row is the one the viewer is on.
  loginSessionId: string | null;
};

/**
 * The single entry point every server action / route handler must call
 * before doing anything authorization-sensitive. Deliberately re-reads
 * role/clearance from Postgres on every call rather than trusting the
 * session token — the DB is the only authority for what a user is allowed
 * to see. See lib/auth/auth.config.ts for why the token itself is
 * role-blind by design.
 */
export async function getAuthContext(): Promise<AuthContext> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new UnauthenticatedError();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true, departments: { select: { id: true, isHeadDepartment: true } } },
  });

  if (!user || user.status !== 'ACTIVE') throw new UnauthenticatedError();

  // sessionId is absent only on a token issued before this feature shipped
  // (it'll get a real LoginSession on the user's next fresh login) —
  // treated as trusted rather than force-logging out every existing
  // session at deploy time. Once present, a missing or revoked row ends
  // the session immediately, same effect as a disabled/removed account.
  const loginSessionId = session.user.sessionId ?? null;
  if (loginSessionId) {
    const loginSession = await getLoginSessionById(loginSessionId);
    if (!loginSession || loginSession.revokedAt) throw new UnauthenticatedError();
    // Best-effort, throttled — never block the request on this.
    touchLoginSession(loginSessionId, loginSession.lastSeenAt).catch(() => {});
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roleName: user.role.name,
    clearanceRank: user.role.hierarchyRank,
    canUploadDocuments: user.role.canUploadDocuments,
    isAdmin: user.role.isAdmin,
    departmentIds: user.departments.map((d) => d.id),
    hasHeadDepartmentAccess: user.departments.some((d) => d.isHeadDepartment),
    themePreference: user.themePreference,
    loginSessionId,
  };
}
