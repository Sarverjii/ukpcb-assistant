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
    if (err instanceof UnauthenticatedError) redirect('/login');
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
