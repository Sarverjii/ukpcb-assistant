import { listDocumentsWithUploader } from '@/lib/db/queries/documents';
import { listRolesByRank } from '@/lib/db/queries/users';
import { DocumentsTable } from '@/components/admin/DocumentsTable';
import { config } from '@/lib/config';

// Next.js requires maxDuration at the PAGE level (not the action file
// itself) to extend the default Server Action timeout — this page's
// "Replace" action (replaceDocumentAction, app/(app)/admin/documents/actions.ts)
// reprocesses a document through the same potentially-slow-on-a-cold-
// instance embedding pipeline as the upload route. See that route's
// matching maxDuration comment for why.
export const maxDuration = 60;

export default async function AdminDocumentsPage() {
  const [documents, roles] = await Promise.all([listDocumentsWithUploader(), listRolesByRank()]);

  return (
    <DocumentsTable
      documents={documents.map((d) => ({
        id: d.id,
        name: d.name,
        uploadedByName: d.uploadedBy.name,
        clearanceLevel: d.clearanceLevel,
        department: d.department,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))}
      roles={roles.map((r) => ({ hierarchyRank: r.hierarchyRank, name: r.name }))}
      useClientUpload={config.STORAGE_PROVIDER === 'vercel-blob'}
    />
  );
}
