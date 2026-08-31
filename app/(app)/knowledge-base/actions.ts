'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAuthContext } from '@/lib/auth/session';
import { requireCanManageDocument, ForbiddenError } from '@/lib/auth/rbac';
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
