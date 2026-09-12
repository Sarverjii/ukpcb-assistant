import {
  getDocument,
  setDocumentStatus,
  setDocumentPreviewFileKey,
  setOcrProgress,
  claimDocumentForProcessing,
  releaseDocumentProcessingClaim,
} from '@/lib/db/queries/documents';
import { insertDocumentChunks, listExistingChunkPageNumbers } from '@/lib/db/queries/chunks';
import { getStorageProvider } from '@/lib/documents/storage';
import { extractStructuredText, MULTI_SEGMENT_MIME_TYPES } from '@/lib/documents/textExtraction';
import { chunkText } from '@/lib/documents/chunking';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLLMProvider } from '@/lib/llm';
import { rasterizePdfPage } from '@/lib/documents/pdfRasterize';
import { logAuditEvent } from '@/lib/audit/log';
import { renderPagesToPdf, type RenderablePage } from '@/lib/documents/pdfRender';

const PDF_MIME = 'application/pdf';

// A PDF page with fewer than this many non-whitespace characters of
// extracted text is treated as scanned (an image with no text layer at
// all) rather than as a real, if unusually short, text page — confirmed
// directly against four real scanned PDFs (all under 10 characters total
// across every page) and against normal text pages in this app's existing
// corpus, which run into the hundreds of characters at minimum. Originally
// 20, which was one character too low: CamScanner (a very common scanning
// app) stamps every page it produces with the 21-character watermark
// "Scanned by CamScanner" as that page's ONLY real text layer — a document
// scanned with it therefore has real, non-whitespace "text" on every page
// but is still 100% image, and at threshold 20 it narrowly cleared the
// bar and was never OCR'd at all (confirmed directly against a real
// CamScanner-scanned document uploaded to this app, whose chunks were
// nothing but that watermark string, repeated). Raised well clear of
// that specific 21-character case while staying far below the
// "hundreds of characters" a real text page has.
const SCANNED_PAGE_TEXT_THRESHOLD = 40;

// Sent verbatim as the vision-model prompt for every OCR'd page, on every
// provider — confirmed directly against a real scanned page (Gemini
// flash-lite) to produce an accurate, well-structured transcription on the
// first try.
const PDF_OCR_PROMPT =
  'Transcribe every piece of text visible in this scanned document image exactly as written, ' +
  'preserving structure (headings, tables, lists) as plain text. If handwritten, do your best to ' +
  'read it. Output only the transcription, no commentary.';

// Wall-clock budget for ONE processDocument() pass's OCR work, checked
// before starting each new page — NOT a hard ceiling on a page already in
// flight, which matters: this only stops a pass from STARTING another
// page once it's over budget, so the real safety margin has to cover one
// full extra page beyond this number, not just up to it.
//
// Was 40_000, measured against local testing (Gemini flash-lite: 10-16s
// per page sequential, a 3-page CONCURRENT batch measured even slower —
// pages are OCR'd one at a time on purpose). Confirmed directly against
// PRODUCTION to be too high: real per-page latency there reached ~32s
// (network path to the provider, cold starts, etc. all add up in a way
// local testing doesn't capture), and a pass that starts a page at ~38s
// in can still be running well past Vercel's real 60s maxDuration,
// getting silently killed mid-write. Confirmed as a real bug, not
// theoretical: a production test run produced duplicate chunks on three
// separate pages from exactly this — see
// lib/db/queries/documents.ts::claimDocumentForProcessing's LOCK_STALE_MS
// comment for the other half of that same fix. 20s leaves real margin
// even against the ~32s worst case actually measured: a pass essentially
// never starts a second page once one has already run long, so it
// finishes cleanly well inside 60s far more reliably than 40s did. Every
// route/action that reaches processDocument() shares that 60s maxDuration
// (see app/api/documents/upload/route.ts's own comment). A scanned
// document longer than fits in one pass simply resumes on the next pass
// (see the module comment below) rather than risking the whole invocation
// getting silently killed mid-write, which this codebase has hit before
// (see knowledge-base/actions.ts's crawl history) and treats as strictly
// worse than an honest, if slower, multi-pass resume.
const PASS_BUDGET_MS = 20_000;

type PendingChunk = { index: number; content: string; pageNumber: number | null };

/**
 * Runs synchronously in the request for MVP scale (~100 documents). Written
 * as a standalone function keyed only by documentId so it can move behind a
 * queue (BullMQ, etc.) later without changing its internals or callers.
 *
 * OCR for scanned PDFs (a page with no text layer — see
 * SCANNED_PAGE_TEXT_THRESHOLD) is resumable across MULTIPLE calls to this
 * same function: every page (native-text or OCR'd) is chunked, embedded,
 * and inserted individually rather than batched into one final write, and
 * listExistingChunkPageNumbers() lets a later call skip whatever an
 * earlier call already finished. A pass that runs out of its time budget
 * (PASS_BUDGET_MS) simply returns without marking the document READY or
 * FAILED — it's still PROCESSING, with ocrPagesDone/ocrPagesTotal
 * reflecting real progress — and app/api/documents/[id]/status/route.ts's
 * idle-nudge calls this function again once that pass has gone quiet.
 * Every other document type (and every already-scanned page a previous
 * pass finished) never touches any of this — a normal document is still
 * fully processed in its original single embed-and-insert call.
 */
export async function processDocument(documentId: string): Promise<void> {
  const passStart = Date.now();
  let claimed = false;

  try {
    const doc = await getDocument(documentId);

    // A resumed pass lands here with status already PROCESSING (set by the
    // very first pass, below) — re-setting it is harmless and keeps this
    // function idempotent to call from either the initial after() or a
    // later idle-nudge without the caller needing to know which this is.
    if (doc.status === 'READY' || doc.status === 'FAILED') return;

    // See claimDocumentForProcessing's own comment — this is what stops
    // two concurrent invocations (a real, confirmed race: the uploader's
    // own status poll and KnowledgeBase.tsx's separate "nudge any visible
    // PROCESSING document" effect can both trigger the idle-nudge within
    // moments of each other) from both OCR-ing and inserting chunks for
    // the same page. Not claiming isn't an error — it just means another
    // invocation already has this document, so there's nothing for this
    // one to do. The `finally` below releases it the moment this pass is
    // done, for any reason.
    claimed = await claimDocumentForProcessing(documentId);
    if (!claimed) return;

    await setDocumentStatus(documentId, 'PROCESSING');

    const storage = getStorageProvider();
    const buffer = await storage.read(doc.fileKey);

    // Each segment is one PDF page or PPTX slide (or, for DOCX/TXT/MD which
    // have no such boundary, the whole document as a single segment) — see
    // extractStructuredText's own docs. Chunking each segment independently
    // means a chunk never straddles a page/slide boundary.
    const segments = await extractStructuredText(buffer, doc.mimeType);
    const hasNativePagination = MULTI_SEGMENT_MIME_TYPES.has(doc.mimeType);
    const isPdf = doc.mimeType === PDF_MIME;

    const scannedSegments = isPdf
      ? segments.filter((s) => s.pageNumber !== null && s.text.trim().length < SCANNED_PAGE_TEXT_THRESHOLD)
      : [];
    const scannedPageNumbers = new Set(scannedSegments.map((s) => s.pageNumber!));

    // What an earlier pass (if any) already finished — every chunk
    // insertion below skips a page already in this set, whether it's a
    // normal text page or a previously-OCR'd scanned page. Snapshotted
    // before this pass adds anything to it, so the final "did this
    // document end up with any real content at all" check (below) can
    // tell "an earlier pass already inserted something" apart from "every
    // page this pass just attempted happened to fail."
    const alreadyDone = await listExistingChunkPageNumbers(documentId);
    const hadExistingContent = alreadyDone.size > 0;

    let insertedChunkCount = 0;

    // --- Pass 1 of this invocation: every NON-scanned segment, exactly
    // like a normal document (fast — no vision calls involved at all). On
    // a resumed invocation this is a no-op for a pure-scan document (every
    // page is in scannedPageNumbers), and for a mixed document it only
    // does the (cheap) work of re-chunking segments already inserted
    // before skipping them via alreadyDone.
    const freshChunks: PendingChunk[] = [];
    let sequentialPage = 0;
    for (const segment of segments) {
      const pageNumber = hasNativePagination ? segment.pageNumber : ++sequentialPage;
      if (pageNumber !== null && scannedPageNumbers.has(pageNumber)) continue; // handled below
      if (pageNumber !== null && alreadyDone.has(pageNumber)) continue; // earlier pass
      for (const c of chunkText(segment.text, { size: 1000, overlap: 150 })) {
        freshChunks.push({ index: freshChunks.length, content: c.content, pageNumber });
      }
    }

    if (freshChunks.length > 0) {
      const embedder = await getEmbeddingProvider();
      const vectors = await embedder.embed(freshChunks.map((c) => c.content), 'RETRIEVAL_DOCUMENT');
      // clearanceLevel AND departments are copied onto every chunk here —
      // see the denormalization note in prisma/schema.prisma and
      // lib/db/queries/chunks.ts.
      await insertDocumentChunks(
        documentId,
        freshChunks,
        vectors,
        doc.clearanceLevel,
        doc.departments.map((d) => d.id),
        embedder.provider,
        embedder.model,
      );
      insertedChunkCount += freshChunks.length;
    }

    // --- Pass 2 of this invocation: OCR whatever scanned pages remain,
    // one at a time, until either they're all done or this pass's time
    // budget runs out.
    const remainingScannedPages = [...scannedPageNumbers].filter((p) => !alreadyDone.has(p)).sort((a, b) => a - b);
    // ocrPagesTotal is set once and never shrinks across passes — the total
    // was already fully known (every scanned page pdf-parse found on THIS
    // pass, which re-parses the whole PDF every time) the moment this
    // document was first identified as a scan. doneCount tracks page
    // ATTEMPTS, not successes — see the catch block below for why a
    // failed page still counts toward it.
    let doneCount = scannedPageNumbers.size - remainingScannedPages.length;
    if (scannedPageNumbers.size > 0) {
      await setOcrProgress(documentId, doneCount, scannedPageNumbers.size);
    }

    if (remainingScannedPages.length > 0) {
      const llm = await getLLMProvider();
      const embedder = await getEmbeddingProvider();

      for (const pageNumber of remainingScannedPages) {
        if (Date.now() - passStart > PASS_BUDGET_MS) break;

        let pageChunks: PendingChunk[] = [];
        try {
          const image = await rasterizePdfPage(buffer, pageNumber);
          const text = await llm.transcribeImage(image, 'image/png', PDF_OCR_PROMPT);
          pageChunks = chunkText(text, { size: 1000, overlap: 150 }).map((c, i) => ({
            index: i,
            content: c.content,
            pageNumber,
          }));
        } catch (err) {
          // A single unreadable/failed page shouldn't fail the whole
          // document (same philosophy as the preview-PDF fallback below)
          // — logged so it's visible, but the rest of the document still
          // becomes searchable. This page is counted as "done" (see
          // ocrPagesDone below) specifically so a permanently-unreadable
          // page doesn't cause every future idle-nudge to retry it
          // forever; a transient failure just means that one page's
          // content is missing, not that the document is stuck.
          const message = err instanceof Error ? err.message : String(err);
          await logAuditEvent({
            action: 'DOCUMENT_PROCESSED',
            result: 'ERROR',
            resource: documentId,
            metadata: { error: `OCR failed for page ${pageNumber} (document still processed): ${message}` },
          });
        }

        if (pageChunks.length > 0) {
          const vectors = await embedder.embed(pageChunks.map((c) => c.content), 'RETRIEVAL_DOCUMENT');
          await insertDocumentChunks(
            documentId,
            pageChunks,
            vectors,
            doc.clearanceLevel,
            doc.departments.map((d) => d.id),
            embedder.provider,
            embedder.model,
          );
          insertedChunkCount += pageChunks.length;
        }

        alreadyDone.add(pageNumber);
        doneCount += 1;
        await setOcrProgress(documentId, doneCount, scannedPageNumbers.size);
      }
    }

    const stillPending = [...scannedPageNumbers].some((p) => !alreadyDone.has(p));
    if (stillPending) {
      // Out of budget with scanned pages left — leave the document exactly
      // as PROCESSING (already set above) with real progress recorded.
      // The idle-nudge in the status route calls processDocument() again
      // once this pass has gone quiet; nothing more to do in THIS pass.
      return;
    }

    // hadExistingContent covers "an earlier pass already inserted real
    // content"; insertedChunkCount covers "this pass did." Neither counts
    // a page that was merely ATTEMPTED-and-failed (see doneCount above) as
    // content, so a scan where every single page's OCR genuinely failed
    // still correctly throws here instead of silently becoming an empty,
    // unsearchable "READY" document.
    if (!hadExistingContent && insertedChunkCount === 0) {
      throw new Error('No extractable text found in document.');
    }

    // A native PDF already IS the viewable file (fileKey) — nothing to
    // generate, scanned or not (the citation preview opens the real PDF
    // directly either way). Every other format gets a clean, generated PDF
    // rendition so the citation preview can always open an actual rendered
    // page instead of falling back to a bare text passage. See
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
          : freshChunks.map((c) => ({ pageNumber: c.pageNumber!, text: c.content }));

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
      metadata: {
        chunkCount: insertedChunkCount,
        clearanceLevel: doc.clearanceLevel,
        ...(scannedPageNumbers.size > 0 ? { ocrPages: scannedPageNumbers.size } : {}),
      },
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
  } finally {
    // Covers every exit path this pass can take — finished (READY),
    // failed (the catch above), and out-of-budget-with-pages-remaining
    // (the early `return` further up) — so the next legitimate
    // continuation never has to wait out LOCK_STALE_MS just because THIS
    // pass happened to finish cleanly.
    if (claimed) await releaseDocumentProcessingClaim(documentId);
  }
}
