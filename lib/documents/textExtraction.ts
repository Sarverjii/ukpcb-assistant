import mammoth from 'mammoth';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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

  if (mimeType === PPTX_MIME) {
    // officeparser's document-structure chunker (splitBy: 'slide') tags
    // each chunk with metadata.slideNumber, but — confirmed by actually
    // running it, not assumed — "never span multiple slides" turned out to
    // mean "slide is the outer boundary", not "one chunk per slide": within
    // a slide it still splits at every paragraph-like AST node regardless
    // of maxChunkSize, so a slide with a title, a bullet, and a caption
    // came back as three separate handful-of-characters chunks instead of
    // one. Reassembling by slideNumber first, then re-chunking with this
    // app's own chunkText() below (same as every other format), gets the
    // per-slide grouping this app actually wants out of it.
    const officeParser = await import('officeparser');
    const ast = await officeParser.parseOffice(buffer, { fileType: 'pptx' });
    const { value: chunks } = await ast.to('chunks', {
      chunksConfig: { strategy: 'document-structure', splitBy: 'slide' },
    });
    const bySlide = new Map<number | null, string[]>();
    for (const c of chunks) {
      const slide = c.metadata.slideNumber ?? null;
      const texts = bySlide.get(slide) ?? [];
      texts.push(c.text);
      bySlide.set(slide, texts);
    }
    return [...bySlide.entries()].map(([pageNumber, texts]) => ({ pageNumber, text: texts.join('\n\n') }));
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return [{ pageNumber: null, text: buffer.toString('utf-8') }];
  }

  throw new Error(`Unsupported document type: ${mimeType}`);
}

export const SUPPORTED_MIME_TYPES = ['application/pdf', DOCX_MIME, PPTX_MIME, 'text/plain', 'text/markdown'];
