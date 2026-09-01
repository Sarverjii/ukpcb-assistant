import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { getUserByIdOrNull } from '@/lib/db/queries/users';
import { listConversationsForUser } from '@/lib/db/queries/conversations';
import { logAuditEvent } from '@/lib/audit/log';
import { LocalTime } from '@/components/admin/LocalTime';

// Admin-only by inheritance — app/(app)/admin/layout.tsx already redirects
// non-admins before this ever renders, so there's no separate access
// check to duplicate here (see that file's requireAdmin-equivalent gate).
//
// listConversationsForUser/getConversationForUser (lib/db/queries/
// conversations.ts) already take an arbitrary userId with no built-in
// assumption it's the caller's own — today only ever called with the
// caller's own ctx.userId, but nothing about them prevents passing a
// target employee's id instead, which is exactly what this page and its
// [conversationId] sibling do. No new query functions needed for reading.
export default async function EmployeeConversationsPage({
  params,
}: PageProps<'/admin/employees/[id]'>) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const employee = await getUserByIdOrNull(id);
  if (!employee) notFound();

  const conversations = await listConversationsForUser(id);

  // Viewing an employee's conversation list is itself audited — reading
  // someone's private chat history is sensitive enough to want an
  // accountability trail, even though it's a legitimate admin capability.
  // Logged once here (list load), not again per conversation opened:
  // opening the list already discloses an admin is looking at this
  // employee's history, and logging again per-conversation would mostly
  // just add noise on top of that same disclosure.
  await logAuditEvent({
    action: 'EMPLOYEE_CONVERSATIONS_VIEWED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: id,
    metadata: { employeeName: employee.name, employeeEmail: employee.email, conversationCount: conversations.length },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/employees" className="text-xs font-medium text-brand-600 hover:underline">
          ← Employees
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{employee.name}&apos;s conversations</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Read-only — {conversations.length} conversation{conversations.length === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((c) => (
              <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/employees/${id}/conversations/${c.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {c.title || 'Untitled conversation'}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  <LocalTime iso={c.updatedAt.toISOString()} />
                </td>
              </tr>
            ))}
            {conversations.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-zinc-400">
                  No conversations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
