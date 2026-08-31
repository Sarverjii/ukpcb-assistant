'use client';

import { useEffect, useRef, useState } from 'react';

// pdfjs-dist is pinned as an exact direct dependency (package.json) — its
// worker script is copied to public/pdf.worker.min.mjs at that same
// version (see the comment below); bumping the package needs re-copying
// that file too, or the two versions mismatch and pdf.js refuses to run.
const PDFJS_WORKER_SRC = '/pdf.worker.min.mjs';

// Renders one PDF page as a real page — a canvas image plus pdf.js's own
// selectable text layer on top (the same technique pdf.js's own viewer
// uses) — with the cited passage highlighted directly on the page,
// instead of embedding the browser's native PDF plugin (its own toolbar,
// download/print buttons, zoom controls — chrome this app has no use for
// and that reads as "someone else's app" rather than part of this one).
// A fixed reading-column width rather than stretching to the container:
// closer to how a real page reads than a full-bleed scaled image.
const PAGE_WIDTH_PX = 620;

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export function PdfPageViewer({
  url,
  pageNumber,
  highlightText,
  onHighlightResult,
}: {
  url: string;
  pageNumber: number;
  highlightText?: string;
  // Fires once per render with whether the cited passage was actually
  // found and highlighted on the page — best-effort matching (see
  // highlightMatchingSpans) doesn't always succeed, and the caller
  // shouldn't claim "highlighted text" happened when it didn't.
  onHighlightResult?: (found: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pageAspect, setPageAspect] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    // pdf.js documents hold real memory (the decoded PDF, cached fonts,
    // etc.) that isn't freed just because the component unmounts —
    // .destroy() is how you tell it to actually release that. Without
    // this, opening several different citations in one session (a modal
    // instance per open, since ChatPanel mounts/unmounts this
    // conditionally) would accumulate one un-freed document per citation
    // previewed.
    let pdfDoc: { destroy: () => Promise<void> } | null = null;

    async function render() {
      setState({ status: 'loading' });
      // eslint-disable-next-line no-console
      console.log('[highlight-debug] render() start, page', pageNumber, 'hasHighlightText', !!highlightText);
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

        const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        pdfDoc = doc;
        if (cancelled) return;
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = PAGE_WIDTH_PX / baseViewport.width;
        const viewport = page.getViewport({ scale });
        setPageAspect(viewport.width / viewport.height);

        const canvas = canvasRef.current;
        const textLayerEl = textLayerRef.current;
        if (!canvas || !textLayerEl) return;

        // Render at device-pixel resolution for crispness on retina
        // displays, but keep the element's CSS/logical size (and the text
        // layer's own coordinate space) at the un-multiplied viewport size
        // — otherwise the selectable text wouldn't line up with the image.
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);

        const task = page.render({ canvas, canvasContext: ctx, viewport });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        textLayerEl.style.width = `${viewport.width}px`;
        textLayerEl.style.height = `${viewport.height}px`;
        textLayerEl.replaceChildren();
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        const didHighlight = highlightText
          ? highlightMatchingSpans(textLayer.textDivs, textContent.items as PositionedTextItem[], highlightText)
          : false;
        // TEMPORARY diagnostic — remove once the live/offline extraction
        // discrepancy is root-caused. Logs to the browser console only.
        // eslint-disable-next-line no-console
        console.log('[highlight-debug] didHighlight =', didHighlight, 'textDivs.length', textLayer.textDivs.length, 'items.length', (textContent.items as PositionedTextItem[]).length);
        if (highlightText && !didHighlight) {
          console.log('[highlight-debug] page', pageNumber, 'items', JSON.stringify((textContent.items as PositionedTextItem[]).slice(0, 12)));
          console.log('[highlight-debug] highlightText', JSON.stringify(highlightText.slice(0, 200)));
        }
        onHighlightResult?.(didHighlight);

        setState({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not load this page.' });
      }
    }

    render();
    return () => {
      // eslint-disable-next-line no-console
      console.log('[highlight-debug] cleanup running, page', pageNumber);
      cancelled = true;
      renderTask?.cancel();
      pdfDoc?.destroy();
    };
  }, [url, pageNumber, highlightText, onHighlightResult]);

  return (
    <div className="flex justify-center bg-zinc-200 dark:bg-zinc-950 px-4 py-6">
      <div
        className="relative overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15),0_8px_24px_rgba(0,0,0,0.12)]"
        style={{
          width: PAGE_WIDTH_PX,
          // Keeps the page-shaped placeholder box stable (no layout jump)
          // once we know the real aspect ratio; a generic 1.3:1 (roughly
          // US Letter) guess while still loading.
          aspectRatio: pageAspect ?? 1.3,
        }}
      >
        {state.status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            Loading page…
          </div>
        )}
        {state.status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-red-500">
            {state.message}
          </div>
        )}
        <canvas ref={canvasRef} className="block" />
        {/* pdf.js's standard invisible-but-selectable text layer — its own
            stylesheet class names below match what TextLayer expects. */}
        <div ref={textLayerRef} className="pdf-text-layer" />
      </div>
    </div>
  );
}

// The subset of pdf.js's TextItem this needs — real position/size data,
// not just the string, which is what makes gap-aware joining possible
// below (see highlightMatchingSpans's doc comment).
type PositionedTextItem = { str: string; transform: number[]; width: number };

/**
 * Finds which of pdf.js's per-run text elements correspond to the cited
 * passage and marks them for a CSS highlight. Matches on a normalized
 * (whitespace-collapsed, lowercased) comparison — the live text layer and
 * the chunk's stored text both ultimately come from the same PDF via the
 * same underlying library, but were extracted through two different call
 * paths (pdf-parse server-side at upload time vs. pdf.js's getTextContent
 * here), so exact byte-for-byte equality isn't guaranteed even though the
 * content is. Only the first ~200 characters of the passage are searched
 * for. No match simply means no highlight — the page itself still renders
 * correctly either way, this is a best-effort enhancement, not something
 * the page display depends on.
 *
 * Tries a decreasing sequence of word-count windows (20 words, then 14,
 * 10, 6) rather than one fixed-length attempt — confirmed by actually
 * testing against a real cited passage that a single differently-encoded
 * character breaks a naive whole-string match entirely: pdf-parse
 * (server-side, at upload time) and pdf.js's live getTextContent (here)
 * are the same underlying library but different call paths, and a bullet
 * glyph or curly quote landing anywhere inside one long needle fails the
 * whole substring search. Shortening the window is a cheap way to route
 * around a single bad character without needing to know where it is;
 * normalizing the most common offenders (bullets, curly quotes/dashes)
 * below fixes the common cases outright.
 *
 * The join between items is position-aware, not a blanket space —
 * measured directly against a real production failure, not assumed: pdf.js
 * routinely splits a single word into multiple adjacent items around a
 * hyphen or kerning adjustment (e.g. "A-5" arrives as three items, "A",
 * "-", "5", touching with ~zero gap between them), and unconditionally
 * inserting a space between every item turned that into "A - 5" — which
 * then never matches the stored chunk's "A-5", failing the highlight for
 * every chunk whose needle crossed one of these splits. Measuring the
 * actual horizontal gap between consecutive items on the same line (via
 * their transform/width) and only inserting a space when that gap is
 * large enough to be a real word boundary fixes it at the source, instead
 * of trying to special-case every punctuation mark that can trigger it.
 */
function highlightMatchingSpans(textDivs: HTMLElement[], items: PositionedTextItem[], highlightText: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/[●•◦‣▪]/g, ' ')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ');

  // Build the full page text alongside a map from each character offset
  // back to which item index it belongs to, so a match found in the
  // concatenated string can be traced back to specific <span> elements.
  let haystack = '';
  const offsetToItem: number[] = [];
  let prevEndX: number | null = null;
  let prevY: number | null = null;
  items.forEach((item, itemIndex) => {
    const piece = normalize(item.str);
    const x = item.transform[4];
    const y = item.transform[5];
    // transform[0] is the item's font size along the (unrotated,
    // unskewed) common case this app's generated PDFs and most real-
    // world documents fall into — good enough as a per-item scale
    // reference for "is this gap roughly a real space or just kerning".
    const fontSize = item.transform[0] || 9;
    const sameLine = prevY !== null && Math.abs(y - prevY) < 2;
    const gap = sameLine && prevEndX !== null ? x - prevEndX : Infinity;
    // A real inter-word space is comfortably wider than the near-zero gap
    // between two items pdf.js split out of what was visually one
    // contiguous run — confirmed directly against real extracted
    // coordinates, not guessed. A gap can also be meaningfully NEGATIVE
    // (not just near-zero) when a PDF places fields like a "Page X of Y"
    // footer out of left-to-right order in the content stream — the
    // lower bound excludes that case from "no space needed" too, since
    // treating a large negative gap the same as a near-zero one glued
    // unrelated words together (measured directly: a real "Page X of Y"
    // footer came back "of1" instead of "of 1").
    const noSpaceNeeded = gap > -1 && gap <= fontSize * 0.15;
    // Only skip the synthetic space when nothing would separate this
    // piece from the last — an item's own string can already end in
    // whitespace (pdf.js sometimes emits a lone " " as its own item), and
    // adding another one on top produced a double space that
    // normalize()'s per-piece whitespace collapse never caught, since it
    // only ever saw one piece at a time, never the join between two.
    if (haystack.length > 0 && !haystack.endsWith(' ') && !noSpaceNeeded) {
      haystack += ' ';
      offsetToItem.push(itemIndex);
    }
    for (let i = 0; i < piece.length; i++) offsetToItem.push(itemIndex);
    haystack += piece;
    prevEndX = x + item.width;
    prevY = y;
  });

  const words = normalize(highlightText).trim().split(' ').filter(Boolean);
  if (words.length === 0) return false;

  let matchStart = -1;
  let matchLength = 0;
  // Word-count windows capped to how many words are actually available —
  // a highlightText shorter than 6 words (a short chunk, or a short
  // trailing fragment) would otherwise never get a single attempt, since
  // every fixed window would exceed its length.
  const windows = [...new Set([20, 14, 10, 6, words.length].filter((n) => n <= words.length))].sort(
    (a, b) => b - a,
  );
  for (const wordCount of windows) {
    const needle = words.slice(0, wordCount).join(' ');
    matchStart = haystack.indexOf(needle);
    if (matchStart !== -1) {
      matchLength = needle.length;
      break;
    }
  }
  if (matchStart === -1) return false;

  const matchedItemIndexes = new Set<number>();
  for (let i = matchStart; i < matchStart + matchLength && i < offsetToItem.length; i++) {
    matchedItemIndexes.add(offsetToItem[i]);
  }
  for (const itemIndex of matchedItemIndexes) {
    textDivs[itemIndex]?.classList.add('pdf-highlight');
  }
  return true;
}
