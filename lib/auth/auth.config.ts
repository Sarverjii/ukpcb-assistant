import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { logAuditEvent } from '@/lib/audit/log';
import { createLoginSession } from '@/lib/db/queries/loginSessions';

// First value of X-Forwarded-For (or the platform-specific equivalent) is
// the original client — nothing else in this app has captured IP before
// now (AuditLog.ipAddress has sat unused since it was added), so this is
// the first real caller of it.
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || undefined;
}

// Session strategy note: Auth.js's Credentials provider only officially
// supports JWT sessions (database sessions are for OAuth-style adapter
// flows). That's fine here, and deliberately not a security weakness:
// the JWT is only ever used to carry a stable user id. Every authorization
// decision re-reads role/clearance fresh from Postgres in
// lib/auth/session.ts::getAuthContext() on every request — so a role change
// takes effect on the user's very next request regardless of session
// strategy, and nothing about a user's clearance ever lives in, or is
// trusted from, the token itself.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Auth.js auto-trusts the Host header only on deployment platforms it
  // specifically recognizes (Vercel is one) — anywhere else, including
  // Render, it defaults to rejecting every request with "UntrustedHost"
  // rather than silently trusting an unrecognized proxy. Confirmed directly
  // from Render's own deploy logs. Safe to trust here because the actual
  // authorization boundary never depends on the Host header — every
  // protected call re-derives role/clearance fresh from Postgres via
  // getAuthContext() (see the file-level comment above), so this only
  // affects Auth.js's own redirect/cookie URL construction, not who's
  // allowed to do what.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || user.status !== 'ACTIVE') {
          await logAuditEvent({ action: 'LOGIN_FAILED', result: 'DENIED', metadata: { email } });
          return null;
        }

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) {
          await logAuditEvent({
            action: 'LOGIN_FAILED',
            result: 'DENIED',
            userId: user.id,
            metadata: { email },
          });
          return null;
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await logAuditEvent({ action: 'LOGIN', result: 'SUCCESS', userId: user.id });

        // A revocable record of this specific sign-in — see LoginSession's
        // schema comment. Its id rides along in the JWT (jwt callback below)
        // purely so getAuthContext() can check it hasn't been revoked.
        const loginSession = await createLoginSession({
          userId: user.id,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp(request),
        });

        // Only id/name/email/sessionId go into the token — never role or
        // clearance (see the file-level comment above).
        return { id: user.id, name: user.name, email: user.email, sessionId: loginSession.id };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      // user is only present on the initial sign-in call — this is the one
      // moment sessionId is available to copy onto the token; every later
      // call just carries the value already on token forward untouched.
      if (user?.sessionId) token.sessionId = user.sessionId;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      if (session.user && token.sessionId) session.user.sessionId = token.sessionId;
      return session;
    },
  },
});
