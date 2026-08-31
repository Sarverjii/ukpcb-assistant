import { redirect } from 'next/navigation';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { ProfileMenu } from '@/components/ProfileMenu';
import { BackToChatLink } from '@/components/BackToChatLink';

// One header, two things in it: a way back to chat, and an account menu.
// The previous version inlined every destination (Upload/Admin/Settings),
// the user's name/role, a separate theme toggle, and a separate sign-out
// button directly into the bar — cramped even at desktop width, and it
// needed three different responsive fallbacks (icon-only back link,
// horizontally-scrolling nav, hidden name block) to survive a phone
// screen at all. Everything that isn't "go back" now lives in the same
// ProfileMenu used by the chat sidebar, opened from a single avatar — one
// deliberate, discoverable place for account-level actions instead of a
// wide strip of them.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/login');
    throw err;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 sm:px-6">
        <BackToChatLink />

        <ProfileMenu
          user={{ name: ctx.name, email: ctx.email, roleName: ctx.roleName }}
          canUploadDocuments={ctx.canUploadDocuments}
          isAdmin={ctx.isAdmin}
          initialTheme={ctx.themePreference}
        />
      </header>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
