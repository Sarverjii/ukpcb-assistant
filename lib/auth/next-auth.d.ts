import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      // The LoginSession row created for this sign-in (see auth.config.ts's
      // authorize() and lib/db/queries/loginSessions.ts) — carried through
      // the jwt/session callbacks purely so getAuthContext() can check
      // whether it's since been revoked.
      sessionId: string;
    } & DefaultSession['user'];
  }
  interface User {
    sessionId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionId?: string;
  }
}

// next-auth/jwt.d.ts is a bare `export * from "@auth/core/jwt"` — augmenting
// the re-exporting module alone doesn't reliably merge into the actual
// declared interface for every callback's inferred type, so this augments
// the real source too.
declare module '@auth/core/jwt' {
  interface JWT {
    sessionId?: string;
  }
}
