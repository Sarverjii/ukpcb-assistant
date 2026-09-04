import { signOut } from '@/lib/auth/auth.config';

/**
 * Fixes a real redirect loop: proxy.ts's `isLoggedIn` check is
 * intentionally cookie-only (no DB call — see its own comment on why), so
 * it stays true for a session token whose user has since been deleted or
 * deactivated. getAuthContext() catches that case correctly and used to
 * `redirect('/login')` straight from the Server Component layout that
 * called it — but a plain Server Component can't clear cookies, so the
 * stale, still-cryptographically-valid session token rode along to
 * /login, where proxy.ts's OTHER rule ("logged in and on /login → send to
 * /chat") bounced the request straight back, which getAuthContext()
 * rejected again, forever: confirmed directly by hard-deleting a live
 * test account mid-session and hitting real net::ERR_TOO_MANY_REDIRECTS
 * against production, not assumed from reading the code.
 *
 * A route handler CAN clear cookies (unlike the Server Component that
 * redirects here), so this is the same signOut() call app/(app)/actions.ts's
 * logoutAction() already makes for a normal logout — reused here as the
 * actual fix, not a new mechanism: getAuthContext()'s callers now redirect
 * HERE instead of straight to /login, this clears the stale cookie, and
 * only THEN redirects to /login, so proxy.ts sees a genuinely logged-out
 * request on the next hop and the loop can't restart.
 */
export async function GET() {
  await signOut({ redirectTo: '/login?sessionExpired=1' });
}
