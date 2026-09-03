import { getDocument, setDocumentStatus, setDocumentPreviewFileKey } from '@/lib/db/queries/documents';
import { insertDocumentChunks } from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { extractStructuredText, MULTI_SEGMENT_MIME_TYPES } from '@/lib/documents/textExtraction';
import { chunkText } from '@/lib/documents/chunking';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { logAuditEvent } from '@/lib/audit/log';
import { renderPagesToPdf, type RenderablePage } from '@/lib/documents/pdfRender';

const PDF_MIME = 'application/pdf';

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
    // means a chunk never straddles a page/slide boundary.
    const segments = await extractStructuredText(buffer, doc.mimeType);
    const hasNativePagination = MULTI_SEGMENT_MIME_TYPES.has(doc.mimeType);

    const chunks: { index: number; content: string; pageNumber: number | null }[] = [];
    for (const segment of segments) {
      for (const c of chunkText(segment.text, { size: 1000, overlap: 150 })) {
        // PDF/PPTX/ODP/XLSX/ODS/CSV: the chunk inherits its segment's real
        // page/slide/sheet number. Every other format has no such number
        // in the source file at all (segment.pageNumber is null) — every
        // chunk gets its own sequential page instead, one chunk per
        // generated preview page (below), so a citation still always has
        // somewhere exact to point to. There's always exactly one segment
        // for these formats, so this numbers every chunk in the document
        // 1..N with no gaps.
        const pageNumber = hasNativePagination ? segment.pageNumber : chunks.length + 1;
        chunks.push({ index: chunks.length, content: c.content, pageNumber });
      }
    }

    if (chunks.length === 0) {
      throw new Error('No extractable text found in document.');
    }

    const embedder = await getEmbeddingProvider();
    const vectors = await embedder.embed(chunks.map((c) => c.content), 'RETRIEVAL_DOCUMENT');

    // clearanceLevel AND departments are copied onto every chunk here — see
    // the denormalization note in prisma/schema.prisma and
    // lib/db/queries/chunks.ts.
    await insertDocumentChunks(
      documentId,
      chunks,
      vectors,
      doc.clearanceLevel,
      doc.departments.map((d) => d.id),
    );

    // A native PDF already IS the viewable file (fileKey) — nothing to
    // generate. Every other format gets a clean, generated PDF rendition
    // so the citation preview can always open an actual rendered page
    // instead of falling back to a bare text passage. See
    // lib/documents/pdfRender.ts and previewFileKey's schema doc comment.
    let previewFileKey: string | null = null;
    if (doc.mimeType !== PDF_MIME) {
      try {
        const renderablePages: RenderablePage[] = hasNativePagination
          // One page per slide/sheet, the FULL segment's text (not split
          // by chunk) — mirrors how a real slide/sheet preview should
          // read, and keeps the page numbering identical to the slide/
          // sheet numbers every chunk from this document already carries.
          ? segments
              .filter((s): s is { pageNumber: number; text: string } => s.pageNumber !== null)
              .map((s) => ({ pageNumber: s.pageNumber, text: s.text }))
          // One page per chunk — see the pageNumber assignment above,
          // which this must match exactly for #page=N / getPage(N) to
          // land on the right content.
          : chunks.map((c) => ({ pageNumber: c.pageNumber!, text: c.content }));

        const pdfBuffer = await renderPagesToPdf(renderablePages, doc.name);
        previewFileKey = await storage.save(`${doc.name}-preview.pdf`, pdfBuffer);
      } catch (err) {
        // A failed preview render shouldn't fail the whole document —
        // the chunks are already embedded and the document is usable in
        // chat either way. The citation preview just falls back to the
        // text passage for this one document, same as before this
        // feature existed.
        const message = err instanceof Error ? err.message : String(err);
        await logAuditEvent({
          action: 'DOCUMENT_PROCESSED',
          result: 'ERROR',
          resource: documentId,
          metadata: { error: `Preview PDF generation failed (document still processed): ${message}` },
        });
      }
    }
    await setDocumentPreviewFileKey(documentId, previewFileKey);

    await setDocumentStatus(documentId, 'READY');
    await logAuditEvent({
      action: 'DOCUMENT_PROCESSED',
      result: 'SUCCESS',
      resource: documentId,
      userId: doc.uploadedById ?? undefined,
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
