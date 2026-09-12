'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { requireCanManageDocument, requireCanUploadDocuments, ForbiddenError } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import {
  getDocument,
  createDocument,
  updateDocumentClearance,
  updateDocumentDepartments,
  deleteDocument as deleteDocumentRow,
  updateDocumentFile,
  listIngestedSourceUrls,
} from '@/lib/db/queries/documents';
import { listDepartments, requireNonEmptyDepartments } from '@/lib/db/queries/departments';
import {
  deleteChunksForDocument,
  updateChunksClearanceForDocument,
  updateChunksDepartmentsForDocument,
} from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { fetchUrlForIngestion, discoverSameDomainLinks, UrlFetchError } from '@/lib/documents/urlFetch';
import { getLowestRole } from '@/lib/db/queries/roles';
import { processDocument } from '@/lib/documents/pipeline';
import { config } from '@/lib/config';

export type ActionResult = { error?: string };

const KNOWLEDGE_BASE_PATH = '/knowledge-base';

export async function changeDocumentClearanceAction(
  documentId: string,
  clearanceLevel: number,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const doc = await getDocument(documentId);

  try {
    await requireCanManageDocument(ctx, doc.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
  // Same rule as upload time: you can't hand a document a clearance level
  // above your own, even one you're otherwise allowed to manage — an admin
  // is exempt (they already bypass the ceiling entirely), same as
  // requireCanManageDocument's own admin bypass.
  if (!ctx.isAdmin && clearanceLevel > ctx.clearanceRank) {
    return { error: 'You cannot assign a clearance level above your own.' };
  }

  const previousClearanceLevel = doc.clearanceLevel;
  await updateDocumentClearance(documentId, clearanceLevel);
  // The "re-indexing" the spec calls for: every existing chunk's
  // denormalized clearanceRank is updated so retrieval reflects the new
  // level immediately, without waiting for a re-upload.
  await updateChunksClearanceForDocument(documentId, clearanceLevel);

  await logAuditEvent({
    action: 'DOCUMENT_CLEARANCE_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    // documentName is captured here, not just the id, so this entry stays
    // readable in the audit log even after the document is later deleted
    // or renamed — an id alone becomes meaningless the moment the row it
    // pointed to is gone.
    metadata: { documentName: doc.name, previousClearanceLevel, newClearanceLevel: clearanceLevel },
  });
  revalidatePath(KNOWLEDGE_BASE_PATH);
  return {};
}

/**
 * Retags which departments a document belongs to — same "manage at or
 * below your own clearance" gate as changeDocumentClearanceAction, but
 * doesn't touch clearanceLevel itself; department tags only ever narrow
 * who among the clearance-eligible can see the document (see
 * lib/db/queries/chunks.ts's doc comment for the actual AND semantics),
 * never a way to raise or lower the clearance boundary itself. Re-indexes
 * the denormalized DocumentChunk.departmentIds immediately, exactly
 * mirroring changeDocumentClearanceAction's own re-indexing.
 */
export async function changeDocumentDepartmentsAction(
  documentId: string,
  departmentIds: string[],
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const doc = await getDocument(documentId);

  try {
    await requireCanManageDocument(ctx, doc.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const departmentError = requireNonEmptyDepartments(departmentIds, 'document');
  if (departmentError) return { error: departmentError };

  await updateDocumentDepartments(documentId, departmentIds);
  await updateChunksDepartmentsForDocument(documentId, departmentIds);

  await logAuditEvent({
    action: 'DOCUMENT_DEPARTMENTS_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    metadata: {
      documentName: doc.name,
      previousDepartmentNames: doc.departments.map((d) => d.name),
      newDepartmentCount: departmentIds.length,
    },
  });
  revalidatePath(KNOWLEDGE_BASE_PATH);
  return {};
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const doc = await getDocument(documentId);

  try {
    await requireCanManageDocument(ctx, doc.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  await deleteDocumentRow(documentId); // chunks cascade via FK
  await logAuditEvent({
    action: 'DOCUMENT_DELETED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    // The document row is gone after this — its name/clearance/uploader
    // only survive if captured here, in the log entry itself.
    metadata: {
      documentName: doc.name,
      clearanceLevel: doc.clearanceLevel,
      uploadedById: doc.uploadedById,
    },
  });
  revalidatePath(KNOWLEDGE_BASE_PATH);
  return {};
}

export async function replaceDocumentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();

  const documentId = String(formData.get('documentId') ?? '');
  const file = formData.get('file');
  if (!documentId || !(file instanceof File)) {
    return { error: 'Missing document or file.' };
  }

  const doc = await getDocument(documentId); // 404s (throws) if it doesn't exist
  try {
    await requireCanManageDocument(ctx, doc.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    return { error: `Unsupported file type: ${file.type || 'unknown'}` };
  }
  const maxBytes = config.UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return { error: `File exceeds the ${config.UPLOAD_MAX_MB}MB limit.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storage = getStorageProvider();
  const fileKey = await storage.save(file.name, buffer);

  // Reprocessing in place: old chunks are removed and replaced entirely
  // (not merged) so retrieval never sees a mix of old and new content.
  await deleteChunksForDocument(documentId);
  await updateDocumentFile(documentId, {
    fileKey,
    mimeType: file.type,
    fileSizeBytes: file.size,
  });

  await logAuditEvent({
    action: 'DOCUMENT_REPLACED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    metadata: { documentName: doc.name, newFileName: file.name },
  });

  // See the matching comment in app/api/documents/upload/route.ts: a bare
  // unawaited call here can get killed mid-flight on Vercel the moment this
  // action's response is sent. after() (page-level maxDuration set in
  // app/(app)/knowledge-base/page.tsx) keeps it alive until it settles.
  after(() =>
    processDocument(documentId).catch((err) => {
      console.error('[documents] reprocessing failed', documentId, err);
    }),
  );

  revalidatePath(KNOWLEDGE_BASE_PATH);
  return {};
}

/**
 * Client-direct-upload counterpart to replaceDocumentAction, for the same
 * reason app/api/documents/finalize-upload/route.ts exists alongside the
 * old upload route: Vercel rejects request bodies above ~4.5MB, and
 * replaceDocumentAction's FormData (containing the file itself) is subject
 * to that exact same ceiling as a Server Action. By the time this runs, the
 * browser has already uploaded the file directly to Vercel Blob — this
 * only receives the resulting pathname (a string), never the file bytes.
 */
export async function finalizeReplaceDocumentAction(
  documentId: string,
  pathname: string,
  mimeType: string,
  fileSizeBytes: number,
): Promise<ActionResult> {
  const ctx = await getAuthContext();

  if (!documentId || !pathname) {
    return { error: 'Missing document or file.' };
  }

  const doc = await getDocument(documentId); // 404s (throws) if it doesn't exist
  try {
    await requireCanManageDocument(ctx, doc.clearanceLevel);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return { error: `Unsupported file type: ${mimeType || 'unknown'}` };
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { error: 'Invalid file size.' };
  }

  await deleteChunksForDocument(documentId);
  await updateDocumentFile(documentId, { fileKey: pathname, mimeType, fileSizeBytes });

  await logAuditEvent({
    action: 'DOCUMENT_REPLACED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    metadata: { documentName: doc.name },
  });

  after(() =>
    processDocument(documentId).catch((err) => {
      console.error('[documents] reprocessing failed', documentId, err);
    }),
  );

  revalidatePath(KNOWLEDGE_BASE_PATH);
  return {};
}

/**
 * Adds a document by fetching a web page rather than uploading a file —
 * per an explicit request that URL-sourced content always be visible to
 * every department regardless of who added it. Achieves that by tagging
 * every page with the FULL current department list (passed in by the
 * caller, `addDocumentFromUrlAction`, as `allDepartmentIds`) rather than
 * leaving departments unset — department is mandatory on every document
 * now, so "visible to everyone" has to be reached by actually covering
 * every department, not by exploiting the old zero-departments-means-
 * everyone branch lib/db/queries/chunks.ts's retrieval query still
 * technically has (that branch now only matters for pre-existing rows
 * from before this policy; nothing new is ever created that way again).
 * Clearance still applies exactly as it does for an uploaded file:
 * whatever level the person adding it chooses, capped at their own.
 *
 * The fetched HTML is saved through the storage provider and run through
 * the exact same processDocument pipeline as any other upload — text
 * extraction already understands text/html (lib/documents/textExtraction.ts),
 * so nothing about chunking/embedding/indexing needed to be duplicated for
 * this path.
 */
// Hard cap on how many pages one crawl request will fetch AND process,
// root page included. Kept deliberately small: processDocumentsSequentially
// (below) processes every page's embeddings one at a time within this
// same request's after() callback, which still shares the 60s maxDuration
// every admin action here does. Confirmed directly against production
// that 6 was still too many: the root page alone (26 chunks, using the
// slow per-text-paced fallback some embedding models need) used up
// enough of that budget that the SECOND document's processing was cut
// off mid-flight when Vercel killed the function for running too long —
// left permanently stuck in PROCESSING, no error, no retry, since the
// kill happens below where any catch block could run. 3 leaves real
// margin. A real site can have thousands of pages; this is a "grab a
// couple of the most important ones a human just linked you to," not a
// full-site mirror — run "Add from a URL" again (with crawl checked)
// from a different starting page, or add pages one at a time (crawl
// off), to pull in more without hitting this ceiling. Applies regardless
// of crawlDepth (below) — a deeper crawl just reaches further to try to
// fill this same small quota, it doesn't raise it.
const MAX_CRAWL_PAGES = 3;

export type AddUrlResult = ActionResult & { pagesAdded?: number };

/**
 * Saves one already-fetched page as a Document — the part
 * addDocumentFromUrlAction's single-page and crawl paths both do per
 * page, factored out so crawling isn't a separate reimplementation of
 * document creation. Deliberately does NOT trigger processing itself
 * (unlike every other document-creating action in this file) — see the
 * caller for why: a crawl creates several documents in one request, and
 * processing (which calls the embedding API) needs to happen for them
 * ONE AT A TIME, not N independent after() callbacks racing each other.
 */
async function saveFetchedPageAsDocument(
  page: { html: string; title: string | null; contentType: 'text/html' | 'text/plain' },
  url: string,
  clearanceLevel: number,
  departmentIds: string[],
  uploadedById: string,
): Promise<string> {
  const name = page.title || url;
  const buffer = Buffer.from(page.html, 'utf-8');
  const storage = getStorageProvider();
  const extension = page.contentType === 'text/plain' ? '.txt' : '.html';
  const fileKey = await storage.save(`${name}${extension}`, buffer);

  const document = await createDocument({
    name,
    fileKey,
    mimeType: page.contentType,
    fileSizeBytes: buffer.byteLength,
    clearanceLevel,
    departmentIds,
    uploadedById,
    sourceUrl: url,
  });

  return document.id;
}

/**
 * Processes several just-created documents ONE AT A TIME, not in
 * parallel — confirmed directly against production this matters: every
 * other document-creating action in this app only ever triggers ONE
 * processDocument() per request, but a crawl creates several, and firing
 * that many independent after() callbacks let them all hit the embedding
 * API's shared rate limit at once (real quota, ~100 requests/minute -
 * see GeminiEmbeddingProvider's own comment). All 15 pages from a real
 * evontech.com crawl failed with RESOURCE_EXHAUSTED this way on the
 * first attempt. Awaiting each document's processing before starting the
 * next lets GeminiEmbeddingProvider's own pacing/retry logic (already
 * built for exactly this quota) actually do its job instead of getting
 * trampled by N-way concurrency it never anticipated.
 */
async function processDocumentsSequentially(documentIds: string[]): Promise<void> {
  for (const id of documentIds) {
    try {
      await processDocument(id);
    } catch (err) {
      console.error('[documents] processing failed', id, err);
    }
  }
}

export async function addDocumentFromUrlAction(formData: FormData): Promise<AddUrlResult> {
  const ctx = await getAuthContext();
  try {
    await requireCanUploadDocuments(ctx);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  const url = String(formData.get('url') ?? '').trim();
  const crawl = formData.get('crawl') === 'true';
  // How many link-hops out from the root page to follow — 1 means only
  // pages linked directly from the root (the original behavior), higher
  // values also follow links found on THOSE pages, and so on. Still
  // bounded by MAX_CRAWL_PAGES regardless — depth changes how far the
  // crawl is willing to reach to fill that same small quota, not how
  // many pages it can end up fetching.
  const crawlDepth = Math.min(Math.max(Number(formData.get('crawlDepth') ?? 1) || 1, 1), 3);
  if (!url) return { error: 'A URL is required.' };

  // Per explicit request: URL-sourced content is public to every employee
  // regardless of clearance or department. The clearance half uses the
  // lowest rank currently configured — rather than a hardcoded constant —
  // so this keeps meaning "everyone" even if the hierarchy is later
  // restructured (e.g. a new, even-lower role added). The department half
  // used to rely on leaving departments unset entirely (the retrieval
  // query's dedicated "zero departments = clearance alone" branch) — now
  // that every document must belong to at least one department, "every
  // department" is what achieves the same "everyone" guarantee instead:
  // tagging with the full current list means every employee's own
  // department (itself now mandatory) is always in the overlap, so
  // clearance is once again the only thing actually gating visibility —
  // see saveFetchedPageAsDocument's own comment.
  const lowestRole = await getLowestRole();
  if (!lowestRole) return { error: 'No roles are configured yet.' };
  const clearanceLevel = lowestRole.hierarchyRank;

  const allDepartments = await listDepartments();
  if (allDepartments.length === 0) return { error: 'No departments are configured yet.' };
  const allDepartmentIds = allDepartments.map((d) => d.id);

  let rootUrl: URL;
  try {
    rootUrl = new URL(url);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  let rootPage;
  try {
    rootPage = await fetchUrlForIngestion(url);
  } catch (err) {
    if (err instanceof UrlFetchError) return { error: err.message };
    throw err;
  }

  // Checked once, reused for both the root URL itself and crawl
  // discovery below — a page already in the knowledge base (this exact
  // URL, from any past crawl or single-URL add) is never re-fetched and
  // duplicated into a second document. The root still gets fetched live
  // either way: crawl mode needs its current HTML to discover links from,
  // even on a re-run where the root document itself already exists.
  const existingUrls = await listIngestedSourceUrls();
  const documentIds = existingUrls.includes(url)
    ? []
    : [await saveFetchedPageAsDocument(rootPage, url, clearanceLevel, allDepartmentIds, ctx.userId)];

  // Crawl mode: same-domain pages reachable from the root page within
  // crawlDepth hops, fetched and added the same way, up to the cap
  // above — a breadth-first walk, one "ring" of links at a time. `seen`
  // is seeded from every already-ingested URL (see above) so a page
  // already in the knowledge base is never re-fetched and duplicated,
  // and is then grown with every URL queued THIS run so a link cycle
  // (two pages linking back to each other, or the same page linked from
  // several others) can't cause it to be fetched twice either. A page
  // that fails to fetch (dead link, blocked, non-HTML) is just skipped —
  // one bad link shouldn't fail the whole crawl when most pages came
  // through fine.
  if (crawl && rootPage.contentType === 'text/html') {
    const seen = new Set([url, ...existingUrls]);
    let frontier = discoverSameDomainLinks(rootPage.html, rootUrl).filter((l) => !seen.has(l));
    for (const l of frontier) seen.add(l);

    for (let hop = 0; hop < crawlDepth && frontier.length > 0 && documentIds.length < MAX_CRAWL_PAGES; hop++) {
      const nextFrontier: string[] = [];
      for (const link of frontier) {
        if (documentIds.length >= MAX_CRAWL_PAGES) break;
        try {
          const linkedPage = await fetchUrlForIngestion(link);
          documentIds.push(await saveFetchedPageAsDocument(linkedPage, link, clearanceLevel, allDepartmentIds, ctx.userId));
          if (linkedPage.contentType === 'text/html') {
            for (const deeper of discoverSameDomainLinks(linkedPage.html, rootUrl)) {
              if (!seen.has(deeper)) {
                seen.add(deeper);
                nextFrontier.push(deeper);
              }
            }
          }
        } catch (err) {
          console.warn('[documents] crawl skipped a page', link, err instanceof Error ? err.message : err);
        }
      }
      frontier = nextFrontier;
    }
  }

  // Nothing new to do — the root URL (and, in crawl mode, everything
  // reachable from it) was already in the knowledge base. Not an error
  // exactly, but there's genuinely no document to create or process.
  if (documentIds.length === 0) {
    return {
      error: crawl
        ? 'This page and everything crawlable from it are already in the knowledge base.'
        : 'This page is already in the knowledge base.',
    };
  }

  await logAuditEvent({
    action: 'DOCUMENT_ADDED_FROM_URL',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: rootUrl.hostname,
    metadata: { url, clearanceLevel, crawl, crawlDepth, pagesAdded: documentIds.length },
  });

  // See processDocumentsSequentially's own comment — one after() call
  // processing every page in order, not one per page.
  after(() => processDocumentsSequentially(documentIds));

  revalidatePath(KNOWLEDGE_BASE_PATH);
  return { pagesAdded: documentIds.length };
}
