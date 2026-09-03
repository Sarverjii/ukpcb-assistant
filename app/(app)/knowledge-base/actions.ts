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
} from '@/lib/db/queries/documents';
import {
  deleteChunksForDocument,
  updateChunksClearanceForDocument,
  updateChunksDepartmentsForDocument,
} from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { fetchUrlForIngestion, discoverSameDomainLinks, UrlFetchError } from '@/lib/documents/urlFetch';
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
 * doesn't touch clearanceLevel itself; departments are purely additive to
 * that boundary, never a way to raise or lower it. Re-indexes the
 * denormalized DocumentChunk.departmentIds immediately, exactly mirroring
 * changeDocumentClearanceAction's own re-indexing.
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
 * every department regardless of who added it. Deliberately never accepts
 * a departmentIds param at all: departments is left unset on
 * createDocument, and lib/db/queries/chunks.ts's own retrieval query
 * already treats a chunk with zero departments as visible to everyone
 * (its `cardinality(departmentIds) = 0` branch) — the exact "public/open
 * to all departments" behavior asked for, achieved by reusing an already-
 * shipped, already-tested rule rather than adding a new one. Clearance
 * still applies exactly as it does for an uploaded file: whatever level
 * the person adding it chooses, capped at their own.
 *
 * The fetched HTML is saved through the storage provider and run through
 * the exact same processDocument pipeline as any other upload — text
 * extraction already understands text/html (lib/documents/textExtraction.ts),
 * so nothing about chunking/embedding/indexing needed to be duplicated for
 * this path.
 */
// Hard cap on how many pages one crawl request will fetch, root page
// included — this action runs synchronously within one request/response
// cycle (only each page's chunking/embedding is deferred via after()), so
// it has to fit inside the same maxDuration every other admin action here
// shares. A real site can have thousands of pages; this is a "grab the
// important ones a human just linked you to," not a full-site mirror —
// paste a more specific starting URL (e.g. a section index page) to
// crawl a different slice, or just add more pages one at a time.
const MAX_CRAWL_PAGES = 15;

export type AddUrlResult = ActionResult & { pagesAdded?: number };

/**
 * Saves one already-fetched page as a Document and defers its
 * processing — the part addDocumentFromUrlAction's single-page and
 * crawl paths both do per page, factored out so crawling isn't a
 * separate reimplementation of document creation.
 */
async function saveFetchedPageAsDocument(
  page: { html: string; title: string | null; contentType: 'text/html' | 'text/plain' },
  url: string,
  nameOverride: string,
  clearanceLevel: number,
  uploadedById: string,
): Promise<string> {
  const name = nameOverride || page.title || url;
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
    uploadedById,
    sourceUrl: url,
  });

  after(() =>
    processDocument(document.id).catch((err) => {
      console.error('[documents] processing failed', document.id, err);
    }),
  );

  return document.id;
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
  const nameOverride = String(formData.get('name') ?? '').trim();
  const clearanceLevelRaw = formData.get('clearanceLevel');
  const crawl = formData.get('crawl') === 'true';
  if (!url) return { error: 'A URL is required.' };
  const clearanceLevel = Number(clearanceLevelRaw);
  if (!Number.isFinite(clearanceLevel)) return { error: 'Invalid clearance level.' };
  // Same upload-time sanity check as a file upload (see the upload
  // route's matching comment) — read access is enforced independently at
  // query time regardless.
  if (clearanceLevel > ctx.clearanceRank) {
    return { error: 'You cannot assign a clearance level above your own.' };
  }

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

  await saveFetchedPageAsDocument(rootPage, url, nameOverride, clearanceLevel, ctx.userId);
  let pagesAdded = 1;

  // Crawl mode: same-domain pages linked FROM the root page, fetched and
  // added the same way, up to the cap above. A page that fails to fetch
  // (dead link, blocked, non-HTML) is just skipped — one bad link
  // shouldn't fail the whole crawl when most pages came through fine.
  if (crawl && rootPage.contentType === 'text/html') {
    const links = discoverSameDomainLinks(rootPage.html, rootUrl).filter((l) => l !== url);
    for (const link of links) {
      if (pagesAdded >= MAX_CRAWL_PAGES) break;
      try {
        const linkedPage = await fetchUrlForIngestion(link);
        await saveFetchedPageAsDocument(linkedPage, link, '', clearanceLevel, ctx.userId);
        pagesAdded++;
      } catch (err) {
        console.warn('[documents] crawl skipped a page', link, err instanceof Error ? err.message : err);
      }
    }
  }

  await logAuditEvent({
    action: 'DOCUMENT_ADDED_FROM_URL',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: rootUrl.hostname,
    metadata: { url, clearanceLevel, crawl, pagesAdded },
  });

  revalidatePath(KNOWLEDGE_BASE_PATH);
  return { pagesAdded };
}
