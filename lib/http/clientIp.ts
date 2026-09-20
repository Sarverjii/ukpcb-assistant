// First value of X-Forwarded-For (or the platform-specific equivalent) is
// the original client — shared by lib/auth/auth.config.ts (login audit
// trail) and app/api/public-chat/stream/route.ts (public chat's per-IP
// usage cap), the only two places in this app that need a caller's IP.
export function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || undefined;
}
