import { getDocument, setDocumentStatus } from '@/lib/db/queries/documents';
import { insertDocumentChunks } from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { extractStructuredText } from '@/lib/documents/textExtraction';
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

    // Each segment is one PDF page or PPTX slide (or, for DOCX/TXT/MD which
    // have no such boundary, the whole document as a single segment) — see
    // extractStructuredText's own docs. Chunking each segment independently
    // means a chunk never straddles a page/slide boundary, and every
    // resulting chunk inherits its segment's page/slide number, which is
    // what lets the citation preview open the source PDF to the right page.
    const segments = await extractStructuredText(buffer, doc.mimeType);
    const chunks: { index: number; content: string; pageNumber: number | null }[] = [];
    for (const segment of segments) {
      for (const c of chunkText(segment.text, { size: 1000, overlap: 150 })) {
        chunks.push({ index: chunks.length, content: c.content, pageNumber: segment.pageNumber });
      }
    }

    if (chunks.length === 0) {
      throw new Error('No extractable text found in document.');
    }

    const embedder = getEmbeddingProvider();
    const vectors = await embedder.embed(chunks.map((c) => c.content), 'RETRIEVAL_DOCUMENT');

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
