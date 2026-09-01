import { prisma } from '@/lib/db/prisma';

const TOUCH_THROTTLE_MS = 5 * 60 * 1000; // don't write lastSeenAt on every single request

export function createLoginSession(input: { userId: string; userAgent?: string; ipAddress?: string }) {
  return prisma.loginSession.create({
    data: { userId: input.userId, userAgent: input.userAgent, ipAddress: input.ipAddress },
  });
}

/** Used by getAuthContext() on every request to decide whether the caller's
 * session has been revoked — a plain indexed primary-key lookup. */
export function getLoginSessionById(id: string) {
  return prisma.loginSession.findUnique({ where: { id } });
}

/** Best-effort "last seen" refresh — called from getAuthContext() but only
 * actually writes when more than TOUCH_THROTTLE_MS has passed, so a chatty
 * UI doesn't turn every request into a write. Errors are swallowed by the
 * caller (see session.ts) since this is a nicety, not load-bearing. */
export function touchLoginSession(id: string, lastSeenAt: Date) {
  if (Date.now() - lastSeenAt.getTime() < TOUCH_THROTTLE_MS) return Promise.resolve();
  return prisma.loginSession.update({ where: { id }, data: { lastSeenAt: new Date() } });
}

export function listSessionsForUser(userId: string) {
  return prisma.loginSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  });
}

/** Ownership-scoped, same "scope the query, don't fetch-then-check" pattern
 * as renameConversation — a session id belonging to someone else's account
 * just matches zero rows. */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.loginSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}
