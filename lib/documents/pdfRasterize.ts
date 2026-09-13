// Renders specific pages of a PDF to PNG images — the counterpart to
// pdfRender.ts (which goes the opposite direction: text -> PDF, for
// citation previews). Needed for OCR: a scanned page has no text layer at
// all (see lib/documents/pipeline.ts's own comment), so the only way to
// read it is to hand a vision-capable model an actual image of the page.
//
// pdfjs-dist (already a dependency — pdf-parse uses its own bundled copy
// for text extraction, this uses the top-level package directly) does the
// PDF parsing/layout; @napi-rs/canvas provides the actual pixel surface to
// render onto. @napi-rs/canvas specifically (not the older `canvas`
// package) because it ships prebuilt native binaries per platform — no
// node-gyp/system-library build step, which matters on Vercel's build
// image the same way the dommatrix polyfill in textExtraction.ts was
// chosen for being a pure-JS/portable dependency over anything needing a
// real browser/DOM environment.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { logAuditEvent } from '@/lib/audit/log';

// Points pdfjs at its own bundled OpenJPEG WASM module (ships inside the
// package already — nothing extra to install, and explicitly force-
// included in the deployed bundle by next.config.ts's
// outputFileTracingIncludes, since nothing statically importable
// references it), needed to decode JPEG2000 (JPX) images, the compression
// some real scanned PDFs use for their page images. Without this, pdfjs
// doesn't just skip JPX images — it throws immediately ("Ensure that the
// `wasmUrl` API parameter is provided"), caught nowhere in this module, so
// page.render() below silently produces a BLANK canvas for that page (no
// exception at all) instead of ever failing loudly. Confirmed directly
// against a real 4-page scanned document using JPX: every page came back
// nearly blank (~11KB PNGs vs. ~680KB with real content once this was
// set), which Gemini then correctly reported as having no visible text to
// transcribe — not a RECITATION block, not a real OCR failure, just
// genuinely blank input — producing the exact same misleading "No
// extractable text found in document." this app's own error handling
// reserves for a page that really has nothing on it.
//
// Built from process.cwd() rather than any module-resolution call
// (import.meta.resolve, createRequire().resolve) — confirmed directly
// that BOTH fail once this file passes through Turbopack's server
// bundling: import.meta.resolve throws "resolve is not a function", and
// createRequire's require.resolve returns one of Turbopack's own internal
// numeric module ids instead of a real filesystem path (TypeError: "path"
// argument must be of type string, received type number), even with
// pdfjs-dist itself marked serverExternalPackages — the resolution call
// site (this file) is still bundled, regardless of whether its target is.
// process.cwd() should be the project root in both local dev and a
// deployed Vercel function, with node_modules/pdfjs-dist/wasm guaranteed
// present there by outputFileTracingIncludes above — but this is the
// one link in the chain not yet confirmed directly against the REAL
// deployed function (only against a local build), so it tries a couple of
// plausible layouts and self-reports which (if any) actually has the file,
// via the app's own audit log — the only window available into a deployed
// function's real filesystem from here — rather than assuming silently.
// pathToFileURL (not a hand-built file:// string) correctly percent-
// encodes a path containing spaces.
function resolvePdfjsWasmDir(): string {
  const candidates = [join(process.cwd(), 'node_modules/pdfjs-dist/wasm'), join(process.cwd(), '.next/server/node_modules/pdfjs-dist/wasm')];
  const found = candidates.find((dir) => existsSync(join(dir, 'openjpeg.wasm')));
  if (!found) {
    // Fire-and-forget — this runs at module load time, nothing to await
    // onto, and audit logging already never throws (see logAuditEvent's
    // own comment).
    void logAuditEvent({
      action: 'DOCUMENT_PROCESSED',
      result: 'ERROR',
      metadata: {
        error: 'pdfjs-dist wasm directory not found at any expected path — JPEG2000-compressed scanned pages will render blank.',
        cwd: process.cwd(),
        candidatesChecked: candidates,
      },
    });
  }
  return found ?? candidates[0];
}
const PDFJS_WASM_URL = pathToFileURL(resolvePdfjsWasmDir() + '/').href;

// Long-edge target size in pixels. Large enough for a vision model to read
// normal body text reliably (confirmed directly: a 1600px-wide render of a
// real scanned page transcribed correctly on the first try — see
// lib/documents/pipeline.ts's PDF_OCR_PROMPT usage), far short of these
// source files' native resolution (multiple thousand px per side, an
// artifact of how they were scanned) which would only inflate image-token
// cost and upload size for no OCR-quality benefit.
const TARGET_LONG_EDGE_PX = 1600;

/**
 * Renders one 1-based PDF page to a PNG buffer. Callers needing several
 * pages from the same document should still call this once per page
 * (rather than trying to hand-roll a shared pdfjs document handle) — the
 * pipeline only ever OCRs a handful of pages per processing pass (see
 * PASS_BUDGET_MS in pipeline.ts), so re-parsing the PDF per page costs
 * under a second each, not worth the extra state management of keeping a
 * loader open across an await boundary that might span a whole vision-model
 * round trip.
 */
export async function rasterizePdfPage(buffer: Buffer, pageNumber: number): Promise<Buffer> {
  // No workerSrc is configured (there's no bundler-served worker script in
  // this server-only context), so pdfjs runs its parsing on the main
  // thread automatically rather than spinning up a Worker — the same
  // "just works in Node" behavior pdf-parse's own bundled pdfjs copy
  // already relies on for text extraction.
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, wasmUrl: PDFJS_WASM_URL });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const nativeViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_LONG_EDGE_PX / Math.max(nativeViewport.width, nativeViewport.height);
    const viewport = page.getViewport({ scale });

    // Dynamic import: @napi-rs/canvas is only ever needed on this one path
    // (OCR of a scanned page), not on every request that touches this
    // module's neighbors — mirrors the lazy dommatrix/pdf-parse imports
    // already established in textExtraction.ts.
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    // @napi-rs/canvas's CanvasRenderingContext2D is API-compatible with
    // what pdfjs's page.render() expects (the same subset the `canvas`
    // package and browsers both implement) — pdfjs itself has no idea
    // which concrete canvas implementation it's drawing onto.
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

    // `canvas: null` opts into the "canvasContext-only" backwards-
    // compatible render path (see RenderParameters' own doc comment) —
    // @napi-rs/canvas's Canvas isn't a real HTMLCanvasElement, so it can't
    // satisfy the `canvas` property's type, but its 2D context is API-
    // compatible with what pdfjs actually draws through.
    await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await pdf.destroy();
  }
}
