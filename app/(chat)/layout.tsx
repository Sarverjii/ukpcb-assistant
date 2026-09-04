import { redirect } from 'next/navigation';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { listConversationsForUser } from '@/lib/db/queries/conversations';
import { isProviderActive } from '@/lib/db/queries/aiProviders';
import { ChatShell } from '@/components/chat/ChatShell';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    // Not a plain redirect('/login') — see invalidate-session/route.ts's
    // comment for the real redirect loop this fixes (a still-valid
    // session cookie for a since-deleted/deactivated user, which this
    // Server Component has no way to clear itself).
    if (err instanceof UnauthenticatedError) redirect('/api/auth/invalidate-session');
    throw err;
  }

  const [conversations, llmActive, embeddingActive] = await Promise.all([
    listConversationsForUser(ctx.userId),
    isProviderActive('LLM'),
    isProviderActive('EMBEDDING'),
  ]);

  return (
    <ChatShell
      user={{ name: ctx.name, email: ctx.email, roleName: ctx.roleName }}
      canUploadDocuments={ctx.canUploadDocuments}
      isAdmin={ctx.isAdmin}
      initialTheme={ctx.themePreference}
      providerOffline={{ llm: !llmActive, embedding: !embeddingActive }}
      conversations={conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt.toISOString(),
      }))}
    >
      {children}
    </ChatShell>
  );
}
