'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocumentAction } from '@/app/(app)/knowledge-base/actions';
import { deleteEmployeePermanentlyAction } from '@/app/(app)/admin/employees/actions';
import { ReauthDialog } from '@/components/admin/ReauthDialog';
import { LocalTime } from '@/components/admin/LocalTime';

type Document = {
  id: string;
  name: string;
  clearanceLevel: number;
  status: string;
  updatedAt: string;
};

/**
 * The document review + hard-delete step of employee removal (see
 * removeEmployeeAction/deleteEmployeePermanentlyAction). Each document row
 * reuses the existing deleteDocumentAction as-is — it authorizes on the
 * CALLING admin's own clearance, not the original uploader's, so no changes
 * were needed there for this to work. Anything left in this list when
 * "Delete employee permanently" is confirmed survives the hard-delete with
 * its uploader reference cleared, not force-deleted.
 */
export function RemovedEmployeeReview({
  employee,
  documents,
}: {
  employee: { id: string; name: string };
  documents: Document[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(documents);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [showDeleteEmployee, setShowDeleteEmployee] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDeleteDocument(id: string) {
    setDocError(null);
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteDocumentAction(id);
      if (result.error) setDocError(result.error);
      else setRows((prev) => prev.filter((d) => d.id !== id));
      setDeletingId(null);
    });
  }

  async function confirmDeleteEmployee(password: string) {
    const result = await deleteEmployeePermanentlyAction(employee.id, password);
    if (!result.error) router.push('/admin/employees/removed');
    return result;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
          Documents uploaded by {employee.name}
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Delete any you don&apos;t want to keep. Anything left here survives the permanent deletion below,
          shown everywhere as uploaded by &quot;Removed employee&quot;.
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Clearance</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2">{d.name}</td>
                  <td className="px-3 py-2">{d.clearanceLevel}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    <LocalTime iso={d.updatedAt} />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={pending && deletingId === d.id}
                      onClick={() => handleDeleteDocument(d.id)}
                      className="rounded-md border border-red-300 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                    >
                      {pending && deletingId === d.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                    No documents uploaded by this employee.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {docError && <p className="mt-2 text-xs text-red-600">{docError}</p>}
      </div>

      <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-4">
        <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">Delete employee permanently</h2>
        <p className="mt-1 text-sm text-red-700/80 dark:text-red-400/80">
          Deletes {employee.name}&apos;s account for real. Their conversations are deleted along with them.
          Any documents still listed above survive with no uploader on record. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteEmployee(true)}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Delete employee permanently
        </button>
      </div>

      {showDeleteEmployee && (
        <ReauthDialog
          title={`Permanently delete ${employee.name}`}
          description={`This is real, immediate, and cannot be undone. Their conversations will be deleted; anything else will show them as "Removed employee".`}
          confirmLabel="Delete permanently"
          destructive
          onConfirm={confirmDeleteEmployee}
          onClose={() => setShowDeleteEmployee(false)}
        />
      )}
    </div>
  );
}
