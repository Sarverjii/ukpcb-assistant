import { getDocument, setDocumentStatus } from '@/lib/db/queries/documents';
import { insertDocumentChunks } from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { extractText } from '@/lib/documents/textExtraction';
import { chunkText } from '@/lib/documents/chunking';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { logAuditEvent } from '@/lib/audit/log';

/**
 * Runs synchronously in the request for MVP scale (~100 documents). Written
 * as a standalone function keyed only by documentId so it can move behind a
 * queue (BullMQ, etc.) later without changing its internals or callers.
 */
export async function processDocument(documentId: string): Promise<void> {
  await setDocumentStatus(documentId, 'PROCESSING');

  try {
    const doc = await getDocument(documentId);
    const storage = getStorageProvider();
    const buffer = await storage.read(doc.fileKey);

    const text = await extractText(buffer, doc.mimeType);
    const chunks = chunkText(text, { size: 1000, overlap: 150 });

    if (chunks.length === 0) {
      throw new Error('No extractable text found in document.');
    }

    const embedder = getEmbeddingProvider();
    const vectors = await embedder.embed(chunks.map((c) => c.content));

    // clearanceLevel is copied onto every chunk here — see the
    // denormalization note in prisma/schema.prisma and lib/db/queries/chunks.ts.
    await insertDocumentChunks(documentId, chunks, vectors, doc.clearanceLevel);

    await setDocumentStatus(documentId, 'READY');
    await logAuditEvent({
      action: 'DOCUMENT_PROCESSED',
      result: 'SUCCESS',
      resource: documentId,
      userId: doc.uploadedById,
      metadata: { chunkCount: chunks.length, clearanceLevel: doc.clearanceLevel },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setDocumentStatus(documentId, 'FAILED', message);
    await logAuditEvent({
      action: 'DOCUMENT_PROCESSED',
      result: 'ERROR',
      resource: documentId,
      metadata: { error: message },
    });
  }
}
