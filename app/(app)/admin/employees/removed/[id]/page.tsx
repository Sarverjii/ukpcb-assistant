import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUserByIdOrNull } from '@/lib/db/queries/users';
import { listDocumentsByUploader } from '@/lib/db/queries/documents';
import { RemovedEmployeeReview } from '@/components/admin/RemovedEmployeeReview';

// Admin-only by inheritance — see app/(app)/admin/layout.tsx. This page's
// own existence is the "reviewed their documents before hard-delete" gate
// — deleteEmployeePermanentlyAction is only ever offered from here.
export default async function RemovedEmployeeReviewPage({
  params,
}: PageProps<'/admin/employees/removed/[id]'>) {
  const { id } = await params;
  const employee = await getUserByIdOrNull(id);
  if (!employee || employee.status !== 'REMOVED') notFound();

  const documents = await listDocumentsByUploader(id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/employees/removed" className="text-xs font-medium text-brand-600 hover:underline">
          ← Removed employees
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{employee.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {employee.email} · {employee.role.name}
          {employee.departments.length > 0 ? ` · ${employee.departments.map((d) => d.name).join(', ')}` : ''}
        </p>
      </div>

      <RemovedEmployeeReview
        employee={{ id: employee.id, name: employee.name }}
        documents={documents.map((d) => ({
          id: d.id,
          name: d.name,
          clearanceLevel: d.clearanceLevel,
          status: d.status,
          updatedAt: d.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
