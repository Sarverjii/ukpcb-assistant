import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUserByIdOrNull } from '@/lib/db/queries/users';
import { getConversationForUser } from '@/lib/db/queries/conversations';
import { ReadOnlyConversationTranscript, type ReadOnlyMessage } from '@/components/admin/ReadOnlyConversationTranscript';
import { CitationPreviewProvider } from '@/components/chat/CitationPreviewContext';

// Admin-only by inheritance, same as the parent employee page — see that
// file's comment.
export default async function EmployeeConversationDetailPage({
  params,
}: PageProps<'/admin/employees/[id]/conversations/[conversationId]'>) {
  const { id, conversationId } = await params;
  const employee = await getUserByIdOrNull(id);
  if (!employee) notFound();

  // Passing the EMPLOYEE's id here (not the admin's) is what makes this
  // work — getConversationForUser scopes its WHERE by whatever userId is
  // given, so a conversation belonging to `id` is exactly what this
  // returns, and one that doesn't 404s the same way it would for a
  // regular user viewing someone else's conversation id.
  const conversation = await getConversationForUser(conversationId, id);
  if (!conversation) notFound();

  const messages: ReadOnlyMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: (m.citations as ReadOnlyMessage['citations']) ?? undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/admin/employees/${id}`} className="text-xs font-medium text-brand-600 hover:underline">
        ← {employee.name}&apos;s conversations
      </Link>
      {/*
        CitationPreviewProvider is normally only mounted inside ChatShell
        ((chat) route group's layout) — these admin pages live under the
        sibling (app) group, which has no such provider, so useCitationPreview()
        inside ReadOnlyConversationTranscript would throw without mounting
        one locally here. It's a plain, reusable component, nothing
        chat-route-specific about it.

        Known v1 limitation: getCitationPreviewAction checks a clicked
        citation against the CALLER's (admin's) own clearance, not the
        employee's — if an admin ever had isAdmin:true but a lower
        hierarchyRank than the employee, a citation the employee legitimately
        saw could show "not authorized" for the admin. Not an issue today
        (the only admin account also holds the highest clearance rank), and
        deliberately not "fixed" by loosening chunk-authorization semantics
        as a side effect of this feature — that's a confidentiality-critical
        path that shouldn't change for an unrelated reason.
      */}
      <CitationPreviewProvider>
        <ReadOnlyConversationTranscript employeeName={employee.name} title={conversation.title} messages={messages} />
      </CitationPreviewProvider>
    </div>
  );
}
