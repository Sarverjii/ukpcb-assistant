import { auth } from '@/lib/auth/auth.config';
import { prisma } from '@/lib/db/prisma';

/**
 * Resolves the theme for the ROOT layout, which renders for both
 * authenticated and unauthenticated routes (login included) — so unlike
 * getAuthContext(), this never throws for a logged-out visitor; it just
 * falls back to the LIGHT default. Reads the DB-backed preference (not
 * localStorage) so it's resolved server-side before first paint — no
 * flash of the wrong theme, and it's account-level: it follows the user
 * to a new browser or device instead of resetting.
 */
export async function getThemePreference(): Promise<'LIGHT' | 'DARK'> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return 'LIGHT';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { themePreference: true },
  });
  return user?.themePreference ?? 'LIGHT';
}
