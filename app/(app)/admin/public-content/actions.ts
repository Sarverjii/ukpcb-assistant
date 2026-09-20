'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import {
  createDocument,
  getDocument,
  deleteDocument as deleteDocumentRow,
  listIngestedSourceUrls,
  resetDocumentForRetry,
} from '@/lib/db/queries/documents';
import { getStorageProvider } from '@/lib/documents/storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { UrlFetchError, type FetchedPage } from '@/lib/documents/urlFetch';
import { crawlSite, MAX_CRAWL_DEPTH } from '@/lib/documents/siteCrawl';
import { getCrawlSite, upsertCrawlSite, touchCrawlSite, updateCrawlSiteDepth } from '@/lib/db/queries/crawlSites';
import { processDocument } from '@/lib/documents/pipeline';
import { config } from '@/lib/config';

export type ActionResult = { error?: string };

const PUBLIC_CONTENT_PATH = '/admin/public-content';

/**
 * A document reachable through Admin → Public Content is a genuinely
 * separate pool from the main Knowledge Base — see Document.isPublic's own
 * schema.prisma comment. Every action here is gated on requireAdmin ALONE
 * (not requireCanManageDocument's clearance/canUploadDocuments machinery,
 * which has no meaning for a document that carries no clearance level,
 * department, or location worth checking) — reachable by any admin,
 * exactly mirroring this whole section's placement under /admin.
 * clearanceLevel is still set (to 0) purely because the column is
 * non-nullable on Document; it plays no role in who can see this content
 * (see retrievePublicChunks's OR-bypass).
 */
const PUBLIC_CLEARANCE_LEVEL = 0;

/**
 * Saves one already-fetched page as a public Document — the crawl and
 * single-page paths both do this per page, exactly mirroring the main
 * Knowledge Base's own saveFetchedPageAsDocument, minus the clearance/
 * department/location a public document doesn't carry. Deliberately does
 * NOT trigger processing itself — a crawl can create several documents in
 * one request, and processing (which calls the embedding API) needs to
 * happen for them ONE AT A TIME, not N independent after() callbacks
 * racing each other (see processDocumentsSequentially below).
 */
async function saveFetchedPublicPageAsDocument(page: FetchedPage, url: string, uploadedById: string): Promise<string> {
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
    clearanceLevel: PUBLIC_CLEARANCE_LEVEL,
    locationIds: [],
    uploadedById,
    sourceUrl: url,
    isPublic: true,
  });

  return document.id;
}

/** Same reasoning as the main Knowledge Base's own processDocumentsSequentially — see that function's comment. */
async function processDocumentsSequentially(documentIds: string[]): Promise<void> {
  for (const id of documentIds) {
    try {
      await processDocument(id);
    } catch (err) {
      console.error('[public-content] processing failed', id, err);
    }
  }
}

/**
 * Adds one public page by URL — with an optional crawl, same shape and
 * same shared engine (lib/documents/siteCrawl.ts) as the main Knowledge
 * Base's addDocumentFromUrlAction, just tagging every page public instead
 * of with clearance/department/location.
 */
export async function addPublicUrlAction(formData: FormData): Promise<ActionResult & { pagesAdded?: number }> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const url = String(formData.get('url') ?? '').trim();
  const crawl = formData.get('crawl') === 'true';
  const crawlDepth = Math.min(Math.max(Number(formData.get('crawlDepth') ?? 1) || 1, 1), MAX_CRAWL_DEPTH);
  if (!url) return { error: 'A URL is required.' };

  let rootUrl: URL;
  try {
    rootUrl = new URL(url);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  const existingUrls = await listIngestedSourceUrls(true);

  let documentIds: string[];
  try {
    const result = await crawlSite({
      rootUrl: url,
      depth: crawl ? crawlDepth : 0,
      alreadySeenUrls: new Set(existingUrls),
      saveDocument: (page, pageUrl) => saveFetchedPublicPageAsDocument(page, pageUrl, ctx.userId),
    });
    documentIds = result.documentIds;
  } catch (err) {
    if (err instanceof UrlFetchError) return { error: err.message };
    throw err;
  }

  if (documentIds.length === 0) {
    return {
      error: crawl
        ? 'This page and everything crawlable from it are already in the public content.'
        : 'This page is already in the public content.',
    };
  }

  if (crawl) {
    await upsertCrawlSite({ domain: rootUrl.hostname, rootUrl: url, depth: crawlDepth, isPublic: true, uploadedById: ctx.userId });
  }

  await logAuditEvent({
    action: 'DOCUMENT_ADDED_FROM_URL',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: rootUrl.hostname,
    metadata: { url, public: true, crawl, crawlDepth, pagesAdded: documentIds.length },
  });

  after(() => processDocumentsSequentially(documentIds));

  revalidatePath(PUBLIC_CONTENT_PATH);
  return { pagesAdded: documentIds.length };
}

/** Public-content counterpart of reprocessCrawlSiteAction (main Knowledge Base) — see that action's own comment. */
export async function reprocessPublicCrawlSiteAction(crawlSiteId: string): Promise<ActionResult & { pagesAdded?: number }> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const site = await getCrawlSite(crawlSiteId);
  if (!site.isPublic) return { error: 'This site belongs to the Knowledge Base, not Public Content.' };

  const existingUrls = await listIngestedSourceUrls(true);

  let documentIds: string[];
  try {
    const result = await crawlSite({
      rootUrl: site.rootUrl,
      depth: site.depth,
      alreadySeenUrls: new Set(existingUrls),
      saveDocument: (page, pageUrl) => saveFetchedPublicPageAsDocument(page, pageUrl, ctx.userId),
    });
    documentIds = result.documentIds;
  } catch (err) {
    if (err instanceof UrlFetchError) return { error: err.message };
    throw err;
  }

  await touchCrawlSite(crawlSiteId);

  if (documentIds.length > 0) {
    await logAuditEvent({
      action: 'DOCUMENT_ADDED_FROM_URL',
      result: 'SUCCESS',
      userId: ctx.userId,
      resource: site.domain,
      metadata: { url: site.rootUrl, public: true, crawl: true, crawlDepth: site.depth, pagesAdded: documentIds.length, reprocessed: true },
    });
    after(() => processDocumentsSequentially(documentIds));
  }

  revalidatePath(PUBLIC_CONTENT_PATH);
  return { pagesAdded: documentIds.length };
}

/** Public-content counterpart of updateCrawlSiteDepthAction (main Knowledge Base). */
export async function updatePublicCrawlSiteDepthAction(crawlSiteId: string, depth: number): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_CRAWL_DEPTH) {
    return { error: `Depth must be a whole number from 1 to ${MAX_CRAWL_DEPTH}.` };
  }

  const site = await getCrawlSite(crawlSiteId);
  if (!site.isPublic) return { error: 'This site belongs to the Knowledge Base, not Public Content.' };

  await updateCrawlSiteDepth(crawlSiteId, depth);
  revalidatePath(PUBLIC_CONTENT_PATH);
  return {};
}

/**
 * Uploads a public document — the "also add the feature of documents"
 * half. Deliberately the plain single-request path only, no client-
 * direct-to-Blob variant (unlike the main Knowledge Base's upload flow) —
 * Public Content is meant for a handful of reasonably-sized public PDFs/
 * notices, not the large corpus the main upload flow was built to handle,
 * and this keeps the surface small. A file too large for a Server
 * Action's body should go through the main Knowledge Base instead (an
 * admin already has upload rights there) — or just be added by URL if it
 * already lives on the web.
 */
export async function uploadPublicDocumentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const file = formData.get('file');
  const name = String(formData.get('name') ?? '').trim();
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a file first.' };
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

  const document = await createDocument({
    name: name || file.name,
    fileKey,
    mimeType: file.type,
    fileSizeBytes: file.size,
    clearanceLevel: PUBLIC_CLEARANCE_LEVEL,
    locationIds: [],
    uploadedById: ctx.userId,
    isPublic: true,
  });

  await logAuditEvent({
    action: 'DOCUMENT_UPLOAD',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: document.id,
    metadata: { name: document.name, public: true },
  });

  after(() =>
    processDocument(document.id).catch((err) => {
      console.error('[public-content] processing failed', document.id, err);
    }),
  );

  revalidatePath(PUBLIC_CONTENT_PATH);
  return {};
}

export async function retryPublicDocumentAction(documentId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const doc = await getDocument(documentId);
  if (!doc.isPublic) return { error: 'This is not a public document.' };
  if (doc.status !== 'FAILED') return { error: 'This document is not in a failed state.' };

  await resetDocumentForRetry(documentId);
  after(() =>
    processDocument(documentId).catch((err) => {
      console.error('[public-content] retry failed', documentId, err);
    }),
  );

  revalidatePath(PUBLIC_CONTENT_PATH);
  return {};
}

export async function deletePublicDocumentAction(documentId: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const doc = await getDocument(documentId);
  if (!doc.isPublic) return { error: 'This is not a public document.' };

  await deleteDocumentRow(documentId); // chunks cascade via FK
  await logAuditEvent({
    action: 'DOCUMENT_DELETED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
    metadata: { documentName: doc.name, public: true },
  });

  revalidatePath(PUBLIC_CONTENT_PATH);
  return {};
}
