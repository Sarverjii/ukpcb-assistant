import PDFDocument from 'pdfkit';

// A clean, simply-typeset PDF rendition of a non-PDF document (DOCX/PPTX/
// TXT/MD), generated purely in Node — no LibreOffice/Office-viewer service,
// so this works unmodified on Vercel. Exists solely so the citation
// preview can open every document to an actual rendered page via the same
// pdf.js viewer already built for native PDFs (see
// components/chat/PdfPageViewer.tsx) — a citation should never fall back
// to a bare text passage just because its source happened not to be a
// PDF. The ORIGINAL file (fileKey/mimeType on the Document row) is
// untouched and is still what downloads serve; this is a second,
// preview-only rendition (see previewFileKey in prisma/schema.prisma).
//
// Deliberately plain, not a facsimile of the original layout — no attempt
// to reproduce DOCX styling or PPTX slide design. That would need a real
// rendering engine this app doesn't have server-side; a clean, readable
// page of the actual cited text is what the feature needs, not a pixel
// copy of the original.

const PAGE_MARGIN = 56;

export type RenderablePage = { pageNumber: number; text: string };

/**
 * Renders one PDF page per entry in `pages`. Page numbers must be the
 * exact numbers callers want addressable later (via #page=N and pdf.js's
 * getPage(N)) — any gap between the lowest and highest pageNumber is
 * filled with a blank page so page N in the output PDF is always
 * genuinely page N, never shifted by a missing entry (see pipeline.ts's
 * PPTX handling, where a slide with no extractable text leaves a gap in
 * the slide numbers that must NOT shift every later slide's page number).
 */
export async function renderPagesToPdf(pages: RenderablePage[], title: string): Promise<Buffer> {
  if (pages.length === 0) throw new Error('renderPagesToPdf: no pages to render.');

  const byNumber = new Map(pages.map((p) => [p.pageNumber, p.text]));
  const maxPage = Math.max(...pages.map((p) => p.pageNumber));

  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, autoFirstPage: false, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (let n = 1; n <= maxPage; n++) {
    doc.addPage();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#71717a')
      .text(title, { align: 'left' })
      .moveDown(0.75);

    const text = byNumber.get(n);
    if (text) {
      doc.font('Helvetica').fontSize(11).fillColor('#18181b').text(text, { align: 'left', lineGap: 3 });
    } else {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#a1a1aa').text('(No text content on this page.)');
    }
  }

  doc.end();
  return done;
}
