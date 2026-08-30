'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import {
  getDocument,
  updateDocumentClearance,
  deleteDocument as deleteDocumentRow,
  updateDocumentFile,
} from '@/lib/db/queries/documents';
import { deleteChunksForDocument, updateChunksClearanceForDocument } from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { SUPPORTED_MIME_TYPES } from '@/lib/documents/textExtraction';
import { processDocument } from '@/lib/documents/pipeline';
import { config } from '@/lib/config';

export type ActionResult = { error?: string };

export async function changeDocumentClearanceAction(
  documentId: string,
  clearanceLevel: number,
): Promise<ActionResult> {
  const ctx = await requireAdminCtx();

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
    metadata: { newClearanceLevel: clearanceLevel },
  });
  revalidatePath('/admin/documents');
  return {};
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResult> {
  const ctx = await requireAdminCtx();

  await deleteDocumentRow(documentId); // chunks cascade via FK
  await logAuditEvent({
    action: 'DOCUMENT_DELETED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
  });
  revalidatePath('/admin/documents');
  return {};
}

export async function replaceDocumentAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminCtx();

  const documentId = String(formData.get('documentId') ?? '');
  const file = formData.get('file');
  if (!documentId || !(file instanceof File)) {
    return { error: 'Missing document or file.' };
  }
  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    return { error: `Unsupported file type: ${file.type || 'unknown'}` };
  }
  const maxBytes = config.UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return { error: `File exceeds the ${config.UPLOAD_MAX_MB}MB limit.` };
  }

  await getDocument(documentId); // 404s (throws) if it doesn't exist

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
  });

  // See the matching comment in app/api/documents/upload/route.ts: a bare
  // unawaited call here can get killed mid-flight on Vercel the moment this
  // action's response is sent. after() (page-level maxDuration set in
  // app/(app)/admin/documents/page.tsx) keeps it alive until it settles.
  after(() =>
    processDocument(documentId).catch((err) => {
      console.error('[documents] reprocessing failed', documentId, err);
    }),
  );

  revalidatePath('/admin/documents');
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
  const ctx = await requireAdminCtx();

  if (!documentId || !pathname) {
    return { error: 'Missing document or file.' };
  }
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return { error: `Unsupported file type: ${mimeType || 'unknown'}` };
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { error: 'Invalid file size.' };
  }

  await getDocument(documentId); // 404s (throws) if it doesn't exist

  await deleteChunksForDocument(documentId);
  await updateDocumentFile(documentId, { fileKey: pathname, mimeType, fileSizeBytes });

  await logAuditEvent({
    action: 'DOCUMENT_REPLACED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: documentId,
  });

  after(() =>
    processDocument(documentId).catch((err) => {
      console.error('[documents] reprocessing failed', documentId, err);
    }),
  );

  revalidatePath('/admin/documents');
  return {};
}

async function requireAdminCtx() {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);
  return ctx;
}
