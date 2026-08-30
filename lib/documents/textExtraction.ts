import mammoth from 'mammoth';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

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

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    await ensureDomMatrixPolyfill();
    // pdf-parse v2 API: instantiate PDFParse, call getText(), then destroy()
    // to free the underlying worker/memory (see node_modules/pdf-parse README
    // — this is a different API shape from pdf-parse v1's bare function call).
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === PPTX_MIME) {
    // officeparser's two-step API: parse to an AST, then render that AST to
    // plain text via ast.to('text') (the current, configurable extractor —
    // its older synchronous ast.toText() is deprecated and drops
    // notes/image placeholders unconditionally, which we don't need here
    // either way since we only want slide body text for chunking).
    const officeParser = await import('officeparser');
    const ast = await officeParser.parseOffice(buffer, { fileType: 'pptx' });
    const { value } = await ast.to('text');
    return value;
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported document type: ${mimeType}`);
}

export const SUPPORTED_MIME_TYPES = ['application/pdf', DOCX_MIME, PPTX_MIME, 'text/plain', 'text/markdown'];
