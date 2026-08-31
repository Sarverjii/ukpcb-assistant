import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { SignOutButton } from '@/components/chat/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/login');
    throw err;
  }

  const initials = ctx.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-3 sm:gap-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Link
            href="/chat"
            className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-brand-600"
          >
            <ArrowLeft size={15} />
            {/* Icon-only below sm — "Back to chat" as text plus the full
                nav list plus the profile block on the right has no room on
                a phone-width header otherwise. */}
            <span className="hidden sm:inline">Back to chat</span>
          </Link>
          {/* min-w-0 lets this shrink and scroll horizontally instead of
              forcing the whole header wider than the viewport — same
              pattern as the admin tab bar (app/(app)/admin/layout.tsx). */}
          <nav className="flex min-w-0 items-center gap-4 overflow-x-auto text-sm whitespace-nowrap">
            {ctx.canUploadDocuments && (
              <Link
                href="/documents/upload"
                className="text-zinc-600 dark:text-zinc-300 hover:text-brand-600"
              >
                Upload Documents
              </Link>
            )}
            {ctx.isAdmin && (
              <Link href="/admin" className="text-zinc-600 dark:text-zinc-300 hover:text-brand-600">
                Admin
              </Link>
            )}
            <Link href="/settings" className="text-zinc-600 dark:text-zinc-300 hover:text-brand-600">
              Settings
            </Link>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle variant="icon" initialTheme={ctx.themePreference} />
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 dark:bg-brand-600 text-xs font-semibold text-white">
            {initials}
          </span>
          {/* Name/role text dropped below sm — the avatar alone is enough
              identity on a phone header, and this is the first thing worth
              giving back to the nav/back-link above once space is tight. */}
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-medium text-zinc-900 dark:text-white">{ctx.name}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{ctx.roleName}</p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
