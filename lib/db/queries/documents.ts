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
  locationIds: string[];
  tags?: string[];
  uploadedById: string;
  // Set only by addDocumentFromUrlAction — see Document.sourceUrl's own
  // comment.
  sourceUrl?: string;
  // Set only by Admin → Public Content's own actions — see Document.isPublic's
  // own comment. Every other caller leaves this false, and — unlike a
  // normal document — a public one is created with empty departmentIds/
  // locationIds; those axes are simply meaningless for it.
  isPublic?: boolean;
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
      locations: { connect: input.locationIds.map((id) => ({ id })) },
      tags: input.tags ?? [],
      uploadedById: input.uploadedById,
      sourceUrl: input.sourceUrl,
      isPublic: input.isPublic ?? false,
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

/**
 * Replaces a document's location tagging entirely (not merged) — same
 * shape as updateDocumentDepartments above, paired with
 * updateChunksLocationsForDocument (lib/db/queries/chunks.ts) at every
 * call site.
 */
export function updateDocumentLocations(id: string, locationIds: string[]) {
  return prisma.document.update({
    where: { id },
    data: { locations: { set: locationIds.map((lid) => ({ id: lid })) } },
  });
}

export function getDocument(id: string) {
  return prisma.document.findUniqueOrThrow({ where: { id }, include: { departments: true, locations: true } });
}

export function setDocumentStatus(id: string, status: DocumentStatus, processingError?: string) {
  return prisma.document.update({
    where: { id },
    data: { status, processingError: processingError ?? null },
  });
}

/**
 * Puts a FAILED document back to PENDING with its error cleared — the
 * "Retry" action (app/(app)/knowledge-base/actions.ts's retryDocumentAction)
 * uses this rather than anything that touches fileKey/mimeType, since
 * nothing about the underlying file changed; only its processing outcome
 * did. Deliberately does NOT reset ocrPagesTotal/ocrPagesDone or delete
 * any chunks already inserted: processDocument() re-derives both from the
 * real DocumentChunk rows and a fresh PDF parse every time it runs (see
 * its own module comment), so a retry correctly RESUMES from whatever
 * pages/content already made it in rather than redoing them — the same
 * behavior that already makes a stalled OCR pass resumable, just reached
 * from a FAILED document instead of a PROCESSING one that ran out of its
 * pass budget.
 */
export function resetDocumentForRetry(id: string) {
  return prisma.document.update({
    where: { id },
    data: { status: 'PENDING', processingError: null },
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
    // isPublic: false — a public document (Admin → Public Content) is a
    // deliberately separate, admin-only-managed pool with no clearance/
    // department/location of its own (see Document.isPublic's own
    // schema.prisma comment); it has no business showing up in the main
    // Knowledge Base's management table (or, via sourceUrl, its Websites
    // tab) where it would render in a broken-looking state (no clearance
    // level selected, "No locations") and — worse — become editable by
    // any canUploadDocuments employee, not just an admin, since its
    // clearanceLevel of 0 trivially passes requireCanManageDocument's
    // clearance check for everyone. listPublicDocuments() is its own,
    // correctly-scoped management list.
    where: { isPublic: false, ...(maxClearanceRank === undefined ? {} : { clearanceLevel: { lte: maxClearanceRank } }) },
    include: { uploadedBy: { select: { name: true, email: true } }, departments: true, locations: true },
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
 * shares a department with it, OR the viewer has head-department access),
 * AND the viewer's single location is among the document's own locations —
 * mirroring the SQL-level rule in lib/db/queries/chunks.ts. A department
 * only ever narrows who a clearance level already admits, never widens it;
 * location narrows unconditionally, with no "no location" escape hatch,
 * since every document is required to carry at least one.
 */
export function listAccessibleDocumentSummariesForBrowsing(
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
  userLocationId: string,
) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      OR: [
        // Public documents bypass clearance/department/location entirely —
        // see Document.isPublic's own comment. Every OTHER document must
        // satisfy the full clearance-AND-department-AND-location rule,
        // nested as its own branch below.
        { isPublic: true },
        {
          clearanceLevel: { lte: userClearanceRank },
          OR: [
            { departments: { none: {} } },
            { departments: { some: { id: { in: userDepartmentIds } } } },
            ...(hasHeadDepartmentAccess ? [{ departments: { some: {} } }] : []),
          ],
          locations: { some: { id: userLocationId } },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      departments: { select: { id: true, name: true } },
      locations: { select: { id: true, name: true } },
      tags: true,
      clearanceLevel: true,
      createdAt: true,
      updatedAt: true,
      // Set only for a document added by pasting a URL — see
      // Document.sourceUrl's own comment. Lets the document library split
      // uploaded files from website pages into their own tab, and link a
      // website page straight to its real live URL instead of the
      // internally generated PDF rendition every uploaded file uses.
      sourceUrl: true,
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
  userLocationId: string,
) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      OR: [
        // Same public bypass as listAccessibleDocumentSummariesForBrowsing —
        // see that function's own comment.
        { isPublic: true },
        {
          clearanceLevel: { lte: userClearanceRank },
          OR: [
            { departments: { none: {} } },
            { departments: { some: { id: { in: userDepartmentIds } } } },
            ...(hasHeadDepartmentAccess ? [{ departments: { some: {} } }] : []),
          ],
          locations: { some: { id: userLocationId } },
        },
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
 * The public counterpart of listAccessibleDocumentSummaries — backs the
 * unauthenticated public chat's document inventory (the "how many
 * documents do you have" style question — see lib/rag/publicChat.ts).
 * ONLY isPublic documents, unconditionally — no clearance/department/
 * location args at all, since there is no caller identity to check them
 * against.
 */
export function listPublicDocumentSummaries() {
  return prisma.document.findMany({
    where: { status: 'READY', isPublic: true },
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Every public document/URL, in every status — backs Admin → Public
 * Content's own management table (the isPublic counterpart of
 * listDocumentsWithUploader). Includes non-READY rows (still
 * processing/failed) so an admin can see and retry/delete those too, same
 * as the main Knowledge Base table does.
 */
export function listPublicDocuments() {
  return prisma.document.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Fetches one document ONLY if it's public — returns null otherwise
 * (never found, or found but not public), never throws. Backs
 * app/api/public-documents/[id]/view/route.ts, the unauthenticated
 * counterpart of [id]/view — the isPublic check here IS the entire
 * authorization boundary for that route, so it must be scoped directly in
 * the WHERE, not applied after a plain fetch.
 */
export function getPublicDocument(id: string) {
  return prisma.document.findFirst({ where: { id, isPublic: true } });
}

/**
 * Every URL already ingested as a document — used by addDocumentFromUrlAction
 * (main Knowledge Base) and addPublicUrlAction (Admin → Public Content) to
 * seed their own "already seen" set so neither re-fetches (and duplicates)
 * a page that's already been added, whether from an earlier crawl, a plain
 * single-URL add, or the same request re-run later. Scoped by `isPublic`
 * to each caller's OWN pool — the two are deliberately independent (see
 * Document.isPublic's own schema.prisma comment), so the same URL must be
 * addable to both without one blocking the other: a page already private
 * to the Knowledge Base isn't "already in" Public Content, and vice versa.
 * Unfiltered by domain (this app's corpus is dozens-to-low-hundreds of
 * documents, not worth a WHERE clause over) — the caller only checks
 * membership, so a URL from a different site costing one extra Set entry
 * is free.
 */
export async function listIngestedSourceUrls(isPublic: boolean): Promise<string[]> {
  const rows = await prisma.document.findMany({
    where: { sourceUrl: { not: null }, isPublic },
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
// own release) rather than genuinely still running.
//
// Was 55_000 — measured directly against production to be too close to
// Vercel's real 60s maxDuration and NOT enough: pipeline.ts's own
// PASS_BUDGET_MS only checks the clock BEFORE starting a new page, so an
// invocation already mid-flight on one slow vision call (production
// measured real per-page latency up to ~32s, well above local testing's
// 10-16s) can still be alive, past 55s, when a second invocation decides
// the lock looks stale and reclaims it — a real test run on production
// produced duplicate chunks for three different pages from exactly this
// window. 90s sits comfortably past the platform's actual 60s kill
// boundary (not just this app's own internal budget check), so a reclaim
// only ever happens once the original invocation is provably dead, not
// while it might still be a zombie finishing its last write.
const LOCK_STALE_MS = 90_000;

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
