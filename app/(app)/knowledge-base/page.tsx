import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { listDocumentsWithUploader } from '@/lib/db/queries/documents';
import { listRolesByRank } from '@/lib/db/queries/users';
import { listDepartments } from '@/lib/db/queries/departments';
import { listLocations } from '@/lib/db/queries/locations';
import { listCrawlSites } from '@/lib/db/queries/crawlSites';
import { KnowledgeBase } from '@/components/documents/KnowledgeBase';
import { config } from '@/lib/config';
import { logAuditEvent } from '@/lib/audit/log';

// Next.js requires maxDuration at the PAGE level (not the action file
// itself) to extend the default Server Action timeout — this page's
// "Replace" action (replaceDocumentAction, ./actions.ts) reprocesses a
// document through the same potentially-slow-on-a-cold-instance embedding
// pipeline as the upload route. See that route's matching maxDuration
// comment for why.
export const maxDuration = 60;

// Gated on canUploadDocuments, not isAdmin — this is the merged "manage
// the whole knowledge base" page (upload + everything the old admin
// Documents tab did), reachable by any role an admin has granted upload
// rights to (Admin → Hierarchy → the "Upload" capability toggle), not just
// admins. requireAdmin-gated actions (Employees, Hierarchy, Audit Log)
// stay a separate, still-admin-only surface — see app/(app)/admin.
export default async function KnowledgeBasePage() {
  const ctx = await getAuthContext();
  // See the matching comment/fix in app/(app)/admin/layout.tsx — same gap,
  // same fix: describeAuditEvent already had a case for this resource
  // ("Blocked: tried to upload a document without permission") with
  // nothing ever calling logAuditEvent to produce it.
  if (!ctx.canUploadDocuments) {
    await logAuditEvent({
      action: 'ACCESS_DENIED',
      result: 'DENIED',
      userId: ctx.userId,
      resource: 'documents:upload',
    });
    redirect('/chat');
  }

  // A non-admin document manager never sees — let alone can act on — a
  // document above their own clearance; an admin still sees everything.
  // Same ceiling both places: the roles list (what you can classify a
  // document as) and the documents list (what you can view/manage).
  const ceiling = ctx.isAdmin ? undefined : ctx.clearanceRank;

  const [documents, roles, departments, locations, crawlSites] = await Promise.all([
    listDocumentsWithUploader(ceiling),
    listRolesByRank(),
    listDepartments(),
    listLocations(),
    listCrawlSites(false),
  ]);
  const availableRoles = roles.filter((r) => ctx.isAdmin || r.hierarchyRank <= ctx.clearanceRank);

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">UKPCB Knowledge Base</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Upload, search, and manage every document your role is cleared to work with — changes here
        take effect in chat immediately.
      </p>
      <div className="mt-6">
        <KnowledgeBase
          isAdmin={ctx.isAdmin}
          roles={availableRoles.map((r) => ({ hierarchyRank: r.hierarchyRank, name: r.name }))}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          crawlSites={crawlSites.map((s) => ({
            id: s.id,
            domain: s.domain,
            depth: s.depth,
            lastCrawledAt: s.lastCrawledAt.toISOString(),
          }))}
          documents={documents.map((d) => ({
            id: d.id,
            name: d.name,
            // uploadedBy is null once that employee has been hard-deleted
            // (see deleteEmployeePermanentlyAction) — the document itself is
            // deliberately kept, just with its uploader reference cleared.
            uploadedByName: d.uploadedBy?.name ?? 'Removed employee',
            clearanceLevel: d.clearanceLevel,
            departments: d.departments.map((dept) => ({ id: dept.id, name: dept.name })),
            locations: d.locations.map((loc) => ({ id: loc.id, name: loc.name })),
            status: d.status,
            createdAt: d.createdAt.toISOString(),
            updatedAt: d.updatedAt.toISOString(),
            sourceUrl: d.sourceUrl,
            ocrPagesTotal: d.ocrPagesTotal,
            ocrPagesDone: d.ocrPagesDone,
            processingError: d.processingError,
          }))}
          useClientUpload={config.STORAGE_PROVIDER === 'vercel-blob'}
          uploadMaxMb={config.UPLOAD_MAX_MB}
        />
      </div>
    </main>
  );
}
