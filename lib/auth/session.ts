import { auth } from '@/lib/auth/auth.config';
import { prisma } from '@/lib/db/prisma';

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
  themePreference: 'LIGHT' | 'DARK';
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
    include: { role: true },
  });

  if (!user || user.status !== 'ACTIVE') throw new UnauthenticatedError();

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roleName: user.role.name,
    clearanceRank: user.role.hierarchyRank,
    canUploadDocuments: user.role.canUploadDocuments,
    isAdmin: user.role.isAdmin,
    themePreference: user.themePreference,
  };
}
