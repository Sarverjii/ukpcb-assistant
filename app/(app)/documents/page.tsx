import { getAuthContext } from '@/lib/auth/session';
import { listAccessibleDocumentSummariesForBrowsing } from '@/lib/db/queries/documents';
import { listRolesByRank } from '@/lib/db/queries/users';
import { listDepartments } from '@/lib/db/queries/departments';
import { DocumentLibraryTable } from '@/components/documents/DocumentLibraryTable';

// Every authenticated active employee can browse this — not gated on
// canUploadDocuments/isAdmin like /knowledge-base is. Ceiling is always
// ctx.clearanceRank, never bypassed for admins: this page shows exactly
// what the viewer is personally cleared to see, not "everything that
// exists" — unlike the management page's admin-sees-all behavior.
export default async function DocumentLibraryPage() {
  const ctx = await getAuthContext();
  const [documents, allRoles, allDepartments] = await Promise.all([
    listAccessibleDocumentSummariesForBrowsing(ctx.clearanceRank, ctx.departmentIds, ctx.hasHeadDepartmentAccess),
    listRolesByRank(),
    listDepartments(),
  ]);
  // The library's own department filter (admin-only, same reasoning as the
  // clearance filter below) still lists every department that exists, not
  // just ones the viewer happens to see documents in — consistent with how
  // the clearance filter lists every role up to the viewer's own rank
  // regardless of whether a document exists at each level yet.
  const departments = ctx.isAdmin ? allDepartments : [];
  // Capped to the viewer's own rank regardless of isAdmin — this page never
  // shows a document above the viewer's own clearance (see the query above),
  // so a filter option for a level they could never see anything at would
  // just be dead UI, even for an admin.
  const roles = allRoles.filter((r) => r.hierarchyRank <= ctx.clearanceRank);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Document library</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Every document you&apos;re cleared to see — {documents.length} document{documents.length === 1 ? '' : 's'}.
      </p>
      <div className="mt-6">
        <DocumentLibraryTable
          documents={documents.map((d) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            departments: d.departments,
            tags: d.tags,
            clearanceLevel: d.clearanceLevel,
            updatedAt: d.updatedAt.toISOString(),
          }))}
          roles={roles.map((r) => ({ hierarchyRank: r.hierarchyRank, name: r.name }))}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          isAdmin={ctx.isAdmin}
        />
      </div>
    </main>
  );
}
