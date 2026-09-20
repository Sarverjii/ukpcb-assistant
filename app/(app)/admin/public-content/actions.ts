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
import { fetchUrlForIngestion, UrlFetchError } from '@/lib/documents/urlFetch';
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
 * Adds one public page by URL — the "mainly URLs" half of this feature.
 * Deliberately no crawl mode (unlike addDocumentFromUrlAction in the main
 * Knowledge Base): Public Content is meant to be a small, deliberately
 * curated set an admin adds one page at a time, not a bulk import surface.
 */
export async function addPublicUrlAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const url = String(formData.get('url') ?? '').trim();
  if (!url) return { error: 'A URL is required.' };

  const existingUrls = await listIngestedSourceUrls(true);
  if (existingUrls.includes(url)) {
    return { error: 'This page is already in the knowledge base.' };
  }

  let page;
  try {
    page = await fetchUrlForIngestion(url);
  } catch (err) {
    if (err instanceof UrlFetchError) return { error: err.message };
    throw err;
  }

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
    uploadedById: ctx.userId,
    sourceUrl: url,
    isPublic: true,
  });

  await logAuditEvent({
    action: 'DOCUMENT_ADDED_FROM_URL',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: document.id,
    metadata: { url, public: true },
  });

  after(() =>
    processDocument(document.id).catch((err) => {
      console.error('[public-content] processing failed', document.id, err);
    }),
  );

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
