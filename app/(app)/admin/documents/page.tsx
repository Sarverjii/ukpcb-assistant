import { listDocumentsWithUploader } from '@/lib/db/queries/documents';
import { listRolesByRank } from '@/lib/db/queries/users';
import { DocumentsTable } from '@/components/admin/DocumentsTable';

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
    />
  );
}
