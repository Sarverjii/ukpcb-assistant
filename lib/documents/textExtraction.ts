import mammoth from 'mammoth';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOC_MIME = 'application/msword';
const RTF_MIME = 'application/rtf';
const HTML_MIME = 'text/html';
const CSV_MIME = 'text/csv';
const JSON_MIME = 'application/json';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const EPUB_MIME = 'application/epub+zip';

// One text segment, tagged with the 1-based PDF page / PPTX slide it came
// from (null when the format has no such concept — DOCX/TXT/MD). The
// document pipeline (lib/documents/pipeline.ts) chunks each segment
// independently and stamps every resulting chunk with its segment's
// pageNumber, so a chunk never straddles a page/slide boundary and the
// citation preview always knows exactly where in the source file a cited
// passage came from.
export type ExtractedSegment = { pageNumber: number | null; text: string };

// pdfjs-dist (used by pdf-parse) tracks the current transformation matrix
// via the browser's DOMMatrix API while walking a PDF's content stream —
// needed even for plain text extraction, since PDFs interleave text and
// graphics operators and text POSITIONING depends on that matrix. Node has
// no DOMMatrix at all. Confirmed directly in production: PDFs with more
// complex content streams (embedded images/graphics, not just plain text)
// failed with "ReferenceError: DOMMatrix is not defined" — a subset, not
// every PDF, since simpler ones never exercise that code path. `dommatrix`
// is a pure-JS, spec-compliant shim (no native bindings, unlike a real
// canvas/DOM implementation) — installed lazily, once, right before the
// first PDF is ever parsed (matches the existing lazy `import('pdf-parse')`
// pattern below rather than a top-level await).
async function ensureDomMatrixPolyfill(): Promise<void> {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;
  const CSSMatrix = (await import('dommatrix')).default;
  globalThis.DOMMatrix = CSSMatrix;
}

export async function extractStructuredText(buffer: Buffer, mimeType: string): Promise<ExtractedSegment[]> {
  if (mimeType === 'application/pdf') {
    await ensureDomMatrixPolyfill();
    // pdf-parse v2 API: instantiate PDFParse, call getText(), then destroy()
    // to free the underlying worker/memory (see node_modules/pdf-parse README
    // — this is a different API shape from pdf-parse v1's bare function call).
    // getText()'s result.pages carries this for free — each PDF page as its
    // own {num, text} entry — no extra parsing work over what this app was
    // already doing to get the old flat result.text.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.pages.map((p) => ({ pageNumber: p.num, text: p.text }));
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === DOCX_MIME) {
    // DOCX has no fixed pagination in the file itself — pages are a
    // function of the viewer/print layout, not stored data — so this stays
    // one unpaginated segment, same as before this change.
    const result = await mammoth.extractRawText({ buffer });
    return [{ pageNumber: null, text: result.value }];
  }

  if (mimeType === PPTX_MIME || mimeType === ODP_MIME) {
    return extractViaOfficeParserPaginated(buffer, mimeType === PPTX_MIME ? 'pptx' : 'odp', 'slide', (m) =>
      typeof m.slideNumber === 'number' ? m.slideNumber : null,
    );
  }

  if (mimeType === XLSX_MIME || mimeType === ODS_MIME || mimeType === CSV_MIME) {
    // sheetName is a string (officeparser has no numeric sheet index), so
    // extractViaOfficeParserPaginated's ordering-by-first-appearance is
    // what turns it into the 1-based page number this app's schema
    // actually needs — see that function's own doc comment.
    return extractViaOfficeParserPaginated(
      buffer,
      mimeType === XLSX_MIME ? 'xlsx' : mimeType === ODS_MIME ? 'ods' : 'csv',
      'sheet',
      (m) => (typeof m.sheetName === 'string' ? m.sheetName : null),
    );
  }

  if (mimeType === DOC_MIME) {
    // Legacy binary Word — mammoth (used for .docx above) only understands
    // the modern ECMA-376 format. word-extractor is a separate, pure-JS
    // parser specifically for the old OLE-based .doc format, no external
    // helper process required (unlike most alternatives, which shell out
    // to a LibreOffice/antiword binary that a serverless deployment
    // doesn't have).
    const WordExtractor = (await import('word-extractor')).default;
    const doc = await new WordExtractor().extract(buffer);
    return [{ pageNumber: null, text: doc.getBody() }];
  }

  if (mimeType === RTF_MIME || mimeType === HTML_MIME || mimeType === ODT_MIME || mimeType === EPUB_MIME) {
    // None of these have a fixed pagination in the file itself, same as
    // DOCX/TXT/MD above — one unpaginated segment.
    const officeParser = await import('officeparser');
    const fileType = mimeType === RTF_MIME ? 'rtf' : mimeType === HTML_MIME ? 'html' : mimeType === ODT_MIME ? 'odt' : 'epub';
    const ast = await officeParser.parseOffice(buffer, { fileType });
    const { value: text } = await ast.to('text');
    return [{ pageNumber: null, text }];
  }

  if (mimeType === JSON_MIME) {
    const raw = buffer.toString('utf-8');
    let text = raw;
    try {
      // Pretty-printed is far more readable once chunked than a single
      // minified line — worth attempting, but a JSON file this app can't
      // parse (malformed, or just too large to bother) still has real
      // content worth indexing as-is rather than failing the upload.
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // fall through with the raw text
    }
    return [{ pageNumber: null, text }];
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return [{ pageNumber: null, text: buffer.toString('utf-8') }];
  }

  throw new Error(`Unsupported document type: ${mimeType}`);
}

/**
 * Shared by every officeparser-backed format that has a natural page-like
 * boundary (PPTX/ODP slides, XLSX/ODS/CSV sheets). officeparser's
 * document-structure chunker splits WITHIN a slide/sheet far more finely
 * than its splitBy boundary suggests — confirmed directly for PPTX (see
 * the historical note preserved in this file's git history): "never span
 * multiple slides" turned out to mean "slide is the outer boundary", not
 * "one chunk per slide" — a slide with a title, a bullet, and a caption
 * came back as three separate handful-of-characters chunks. Regrouping by
 * the page-like key first, then handing each group's full text back as
 * ONE segment for this app's own chunkText() to split (same as every
 * other format), is what actually gets the one-segment-per-page/slide/
 * sheet grouping this app wants out of it — assumed to generalize the
 * same way to ODP/XLSX/ODS/CSV, not independently re-verified per format,
 * since it's the same chunker and the same "boundary vs. size" behavior
 * regardless of which key it's grouping by.
 *
 * `keyOf` extracts whichever raw key a chunk's metadata carries
 * (slideNumber is already numeric; sheetName is a string) — either way,
 * this maps distinct keys to a 1-based page number in first-seen order,
 * since the schema's pageNumber column is always an int.
 */
async function extractViaOfficeParserPaginated(
  buffer: Buffer,
  fileType: 'pptx' | 'odp' | 'xlsx' | 'ods' | 'csv',
  splitBy: 'slide' | 'sheet',
  keyOf: (metadata: Record<string, unknown>) => string | number | null,
): Promise<ExtractedSegment[]> {
  const officeParser = await import('officeparser');
  const ast = await officeParser.parseOffice(buffer, { fileType });
  const { value: chunks } = await ast.to('chunks', {
    chunksConfig: { strategy: 'document-structure', splitBy },
  });

  const order: (string | number)[] = [];
  const byPageNumber = new Map<number, string[]>();
  for (const c of chunks) {
    const rawKey = keyOf(c.metadata) ?? '(unnamed)';
    let idx = order.indexOf(rawKey);
    if (idx === -1) {
      order.push(rawKey);
      idx = order.length - 1;
    }
    const pageNumber = idx + 1;
    const texts = byPageNumber.get(pageNumber) ?? [];
    texts.push(c.text);
    byPageNumber.set(pageNumber, texts);
  }
  return [...byPageNumber.entries()].map(([pageNumber, texts]) => ({ pageNumber, text: texts.join('\n\n') }));
}

// Formats extractStructuredText gives real, multiple page/slide/sheet
// segments for — everything else comes back as exactly one unpaginated
// segment (see each branch above). lib/documents/pipeline.ts uses this to
// decide whether a chunk's pageNumber is the format's own real page/
// slide/sheet number, or a synthetic per-chunk one it has to invent.
export const MULTI_SEGMENT_MIME_TYPES = new Set<string>([
  'application/pdf',
  PPTX_MIME,
  ODP_MIME,
  XLSX_MIME,
  ODS_MIME,
  CSV_MIME,
]);

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  DOCX_MIME,
  PPTX_MIME,
  'text/plain',
  'text/markdown',
  XLSX_MIME,
  DOC_MIME,
  RTF_MIME,
  HTML_MIME,
  CSV_MIME,
  JSON_MIME,
  ODT_MIME,
  ODP_MIME,
  ODS_MIME,
  EPUB_MIME,
];
