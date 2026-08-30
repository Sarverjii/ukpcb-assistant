import { redirect } from 'next/navigation';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { listConversationsForUser } from '@/lib/db/queries/conversations';
import { Sidebar } from '@/components/chat/Sidebar';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/login');
    throw err;
  }

  const conversations = await listConversationsForUser(ctx.userId);

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950">
      <Sidebar
        user={{ name: ctx.name, email: ctx.email, roleName: ctx.roleName }}
        canUploadDocuments={ctx.canUploadDocuments}
        isAdmin={ctx.isAdmin}
        initialTheme={ctx.themePreference}
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
        }))}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
