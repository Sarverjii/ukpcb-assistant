import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getConversationForUser } from '@/lib/db/queries/conversations';
import { listAccessibleDocumentSummaries } from '@/lib/db/queries/documents';
import { ChatPanel, type ChatMessage } from '@/components/chat/ChatPanel';

export default async function ConversationPage({
  params,
}: PageProps<'/chat/[id]'>) {
  const { id } = await params;
  const ctx = await getAuthContext();

  // Scoped to the caller in the query itself (WHERE userId = ...) — a
  // conversation ID belonging to another user simply doesn't match and
  // renders a 404, never someone else's messages.
  const [conversation, documents] = await Promise.all([
    getConversationForUser(id, ctx.userId),
    listAccessibleDocumentSummaries(ctx.clearanceRank, ctx.departmentIds, ctx.hasHeadDepartmentAccess),
  ]);
  if (!conversation) notFound();

  const initialMessages: ChatMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: (m.citations as ChatMessage['citations']) ?? undefined,
    feedback: m.feedback,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
  }));

  // key={conversation.id} forces a full remount on navigation between
  // conversations, so ChatPanel's local message state re-initializes from
  // the new conversation's initialMessages instead of needing an effect to
  // sync it (React's recommended pattern for "reset state when a prop
  // identifying the entity changes").
  return (
    <ChatPanel
      key={conversation.id}
      conversationId={conversation.id}
      initialMessages={initialMessages}
      initialTitle={conversation.title}
      availableDocuments={documents.map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
