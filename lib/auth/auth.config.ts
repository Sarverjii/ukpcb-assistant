import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { logAuditEvent } from '@/lib/audit/log';

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
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
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

        // Only id/name/email go into the token — never role or clearance.
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
