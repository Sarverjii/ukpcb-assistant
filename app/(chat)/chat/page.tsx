import { getAuthContext } from '@/lib/auth/session';
import { listAccessibleDocumentSummaries } from '@/lib/db/queries/documents';
import { ChatPanel } from '@/components/chat/ChatPanel';

// Deliberately does no conversation-related DB read/write — no DB write.
// "/" (which redirects here) and the sidebar's "New chat" link both land on
// this same static draft state. The conversation only starts existing once
// the first message is actually sent (see createConversationAndSendMessage
// in ./actions.ts), at which point ChatPanel navigates to /chat/[id] itself.
// availableDocuments IS fetched here — the document-scope picker in the
// composer needs it before any conversation exists.
export default async function ChatDraftPage() {
  const ctx = await getAuthContext();
  const documents = await listAccessibleDocumentSummaries(ctx.clearanceRank, ctx.departmentIds, ctx.hasHeadDepartmentAccess, ctx.locationId);

  return (
    <ChatPanel
      conversationId={null}
      initialMessages={[]}
      initialTitle={null}
      availableDocuments={documents.map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
