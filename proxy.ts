import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth.config';

// Next.js 16 renamed `middleware` -> `proxy` (same underlying mechanism).
//
// This is a coarse, OPTIMISTIC redirect only — "logged in?" via the JWT
// cookie, nothing more. It is NOT where authorization happens (Next's own
// guidance is explicit that proxy should not be relied on as a full
// session/authorization solution, and it must stay fast, no DB calls). Every
// role/clearance check is done server-side, per request, against the
// database in lib/auth/session.ts::getAuthContext() — that is the actual
// enforcement point.
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname.startsWith('/login');

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/chat', req.nextUrl.origin));
  }
});

export const config = {
  // Excludes Next internals, the auth API, the generated /icon.svg route,
  // and any public/ static asset by extension — without the extension
  // exclusion, a request for e.g. /logo.svg while logged out gets caught
  // by this same redirect-to-/login logic (returning login HTML instead of
  // the image), which is exactly what broke the login page's own logo.
  // Next's own proxy docs warn about this class of bug explicitly.
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
