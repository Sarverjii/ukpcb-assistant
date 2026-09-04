import { prisma } from '@/lib/db/prisma';
import type { DocumentStatus } from '@prisma/client';

export type CreateDocumentInput = {
  name: string;
  description?: string;
  fileKey: string;
  mimeType: string;
  fileSizeBytes: number;
  clearanceLevel: number;
  departmentIds?: string[];
  tags?: string[];
  uploadedById: string;
  // Set only by addDocumentFromUrlAction — see Document.sourceUrl's own
  // comment.
  sourceUrl?: string;
};

export function createDocument(input: CreateDocumentInput) {
  return prisma.document.create({
    data: {
      name: input.name,
      description: input.description,
      fileKey: input.fileKey,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      clearanceLevel: input.clearanceLevel,
      departments: input.departmentIds?.length ? { connect: input.departmentIds.map((id) => ({ id })) } : undefined,
      tags: input.tags ?? [],
      uploadedById: input.uploadedById,
      sourceUrl: input.sourceUrl,
      status: 'PENDING',
    },
  });
}

/**
 * Replaces a document's department tagging entirely (not merged) — paired
 * with updateChunksDepartmentsForDocument (lib/db/queries/chunks.ts) at
 * every call site, exactly mirroring how updateDocumentClearance is always
 * paired with updateChunksClearanceForDocument.
 */
export function updateDocumentDepartments(id: string, departmentIds: string[]) {
  return prisma.document.update({
    where: { id },
    data: { departments: { set: departmentIds.map((did) => ({ id: did })) } },
  });
}

export function getDocument(id: string) {
  return prisma.document.findUniqueOrThrow({ where: { id }, include: { departments: true } });
}

export function setDocumentStatus(id: string, status: DocumentStatus, processingError?: string) {
  return prisma.document.update({
    where: { id },
    data: { status, processingError: processingError ?? null },
  });
}

/**
 * Records (or clears) the storage key of the generated preview PDF — see
 * previewFileKey's doc comment in prisma/schema.prisma. Called once per
 * processing pass (lib/documents/pipeline.ts), always with the outcome of
 * THAT pass: null for a native PDF (nothing to generate) or a document
 * whose preview generation failed, a real key otherwise. Never left
 * pointing at a stale file from a previous pass.
 */
export function setDocumentPreviewFileKey(id: string, previewFileKey: string | null) {
  return prisma.document.update({ where: { id }, data: { previewFileKey } });
}

/**
 * `maxClearanceRank`, when given, restricts the list to documents at or
 * below that level — used for a non-admin knowledge-base manager, who
 * should never even see a document above their own clearance exists (let
 * alone manage it). Admins pass undefined and see everything, same as the
 * original admin Documents table always did.
 */
export function listDocumentsWithUploader(maxClearanceRank?: number) {
  return prisma.document.findMany({
    where: maxClearanceRank === undefined ? undefined : { clearanceLevel: { lte: maxClearanceRank } },
    include: { uploadedBy: { select: { name: true, email: true } }, departments: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Every document a specific employee uploaded, regardless of status —
 * backs the "Removed employees" review page (Feature 7), where an admin
 * decides, per document, whether to keep it (survives with uploadedById
 * set to null once the employee is hard-deleted) or delete it via the
 * existing deleteDocumentAction before that happens.
 */
/**
 * Every READY document tagged with a specific department — backs the
 * Departments admin detail page, so an admin managing a department can see
 * what it actually grants access to, not just who's in it.
 */
export function listDocumentsForDepartment(departmentId: string) {
  return prisma.document.findMany({
    where: { departments: { some: { id: departmentId } }, status: 'READY' },
    select: { id: true, name: true, clearanceLevel: true },
    orderBy: { name: 'asc' },
  });
}

export function listDocumentsByUploader(uploadedById: string) {
  return prisma.document.findMany({
    where: { uploadedById },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Read-only "browse what I'm cleared to see" list for the employee-facing
 * document library (Feature 2) — distinct from listDocumentsWithUploader
 * (management page: leaks uploader email, shows non-READY documents) and
 * listAccessibleDocumentSummaries (too narrow: no department/tags/dates,
 * built for the RAG document-inventory prompt, not a browsing UI).
 * Deliberately never takes an isAdmin bypass — every viewer, admin
 * included, sees only what their own clearanceRank/departments allow here.
 * Clearance is a hard requirement (`clearanceLevel: { lte: userClearanceRank }`
 * at the top level, not inside the OR): a document is shown only if the
 * clearance check passes AND (it has no department at all, OR the viewer
 * shares a department with it, OR the viewer has head-department access) —
 * mirroring the SQL-level rule in lib/db/queries/chunks.ts. A department
 * only ever narrows who a clearance level already admits, never widens it.
 */
export function listAccessibleDocumentSummariesForBrowsing(
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      clearanceLevel: { lte: userClearanceRank },
      OR: [
        { departments: { none: {} } },
        { departments: { some: { id: { in: userDepartmentIds } } } },
        ...(hasHeadDepartmentAccess ? [{ departments: { some: {} } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      departments: { select: { id: true, name: true } },
      tags: true,
      clearanceLevel: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
  });
}

export function updateDocumentClearance(id: string, clearanceLevel: number) {
  return prisma.document.update({ where: { id }, data: { clearanceLevel } });
}

export function deleteDocument(id: string) {
  // Chunks cascade-delete via the FK (onDelete: Cascade in schema.prisma).
  return prisma.document.delete({ where: { id } });
}

/** Swaps in a new file for an existing document, resetting it for reprocessing. */
export function updateDocumentFile(
  id: string,
  file: { fileKey: string; mimeType: string; fileSizeBytes: number },
) {
  return prisma.document.update({
    where: { id },
    data: { ...file, status: 'PENDING', processingError: null },
  });
}

/**
 * Document *metadata* (names/descriptions), filtered the same way as
 * retrieveAuthorizedChunks() — clearanceLevel <= the caller's rank, in the
 * query itself. This is what answers "how many documents do you have" /
 * "what documents exist" style questions: that information was never in any
 * chunk's CONTENT (no document says "there are N documents"), so semantic
 * retrieval correctly finds nothing for it regardless of clearance — this
 * is a different data source (document inventory, not document content),
 * not a relaxation of the content-retrieval boundary. See
 * lib/rag/chat.ts::answerQuestion for how the two are kept separate in the
 * prompt the model actually sees. `userDepartmentIds`/`hasHeadDepartmentAccess`
 * enforce the same clearance-AND-department rule as
 * listAccessibleDocumentSummariesForBrowsing above.
 */
export function listAccessibleDocumentSummaries(
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      clearanceLevel: { lte: userClearanceRank },
      OR: [
        { departments: { none: {} } },
        { departments: { some: { id: { in: userDepartmentIds } } } },
        ...(hasHeadDepartmentAccess ? [{ departments: { some: {} } }] : []),
      ],
    },
    // id isn't sent to the LLM (see DocumentSummary in lib/llm/types.ts,
    // which only carries name/description) — it's used server-side by
    // lib/rag/documentNameMatch.ts to look up chunks when the question
    // names one of these documents directly.
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Every URL already ingested as a document — used by addDocumentFromUrlAction
 * to seed a crawl's "already seen" set so it never re-fetches (and
 * duplicates) a page that's already been added, whether from an earlier
 * crawl, a plain single-URL add, or the same crawl request re-run later.
 * Unfiltered by domain (this app's corpus is dozens-to-low-hundreds of
 * documents, not worth a WHERE clause over) — the caller only checks
 * membership, so a URL from a different site costing one extra Set entry
 * is free.
 */
export async function listIngestedSourceUrls(): Promise<string[]> {
  const rows = await prisma.document.findMany({
    where: { sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  return rows.map((r) => r.sourceUrl!);
}

/**
 * Records OCR progress on a document — see Document.ocrPagesTotal/
 * ocrPagesDone's own schema comment. `total` is only ever passed on the
 * FIRST pass that discovers scanned pages (subsequent passes call this
 * with only `done` advancing); `updatedAt` bumping on every call is what
 * lets the status route's idle-nudge (see that route's own comment) tell
 * "a pass just made progress" apart from "a pass is genuinely stalled."
 */
export function setOcrProgress(id: string, done: number, total: number) {
  return prisma.document.update({
    where: { id },
    data: { ocrPagesDone: done, ocrPagesTotal: total },
  });
}

// A lock older than this is treated as abandoned (the invocation holding
// it crashed, or was killed by the platform mid-pass, before reaching its
// own release) rather than genuinely still running — comfortably longer
// than pipeline.ts's own PASS_BUDGET_MS (40s) plus the request overhead
// around it, so a real, still-active pass never looks stale here.
const LOCK_STALE_MS = 55_000;

/**
 * A real hold-for-the-duration lock — see Document.processingClaimedAt's
 * own schema comment for why an updatedAt-based compare-and-swap wasn't
 * enough on its own: that only stops two invocations from racing on the
 * exact same instant, not one invocation claiming a document a second
 * later while an earlier pass is still legitimately mid-flight on a
 * single page's vision-model call (which takes several real seconds, with
 * no DB write happening until it returns). Confirmed as a real,
 * reproduced bug either way — one real test run produced ~4x the expected
 * chunk count for a single page from exactly this race.
 *
 * Claims by setting processingClaimedAt to now() ONLY if it's currently
 * null or older than LOCK_STALE_MS — every other write during a pass
 * (setOcrProgress, etc.) does NOT touch this column, so the lock stays
 * held for the pass's whole duration regardless of how many separate
 * writes happen. Pair with releaseDocumentProcessingClaim() in a finally
 * block so a pass that finishes cleanly (for any reason: done, failed, or
 * out of budget) frees the lock immediately rather than making the next
 * legitimate continuation wait out the full staleness window.
 */
export async function claimDocumentForProcessing(id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const result = await prisma.document.updateMany({
    where: { id, OR: [{ processingClaimedAt: null }, { processingClaimedAt: { lt: staleBefore } }] },
    data: { processingClaimedAt: new Date() },
  });
  return result.count > 0;
}

export async function releaseDocumentProcessingClaim(id: string): Promise<void> {
  await prisma.document.update({ where: { id }, data: { processingClaimedAt: null } });
}
