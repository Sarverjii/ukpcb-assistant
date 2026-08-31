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
}: {
  url: string;
  pageNumber: number;
  highlightText?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pageAspect, setPageAspect] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    async function render() {
      setState({ status: 'loading' });
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

        const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
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

        if (highlightText) {
          highlightMatchingSpans(textLayer.textDivs, textLayer.textContentItemsStr, highlightText);
        }

        setState({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not load this page.' });
      }
    }

    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [url, pageNumber, highlightText]);

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
 */
function highlightMatchingSpans(textDivs: HTMLElement[], itemStrings: string[], highlightText: string): void {
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
  itemStrings.forEach((str, itemIndex) => {
    const piece = normalize(str);
    for (let i = 0; i < piece.length; i++) offsetToItem.push(itemIndex);
    haystack += piece;
    // Items don't include the space between text runs pdf.js inserts
    // structurally (e.g. between words split across positioning
    // adjustments) — approximate it with one space so a match spanning
    // two items isn't glued together into one unmatchable word.
    haystack += ' ';
    offsetToItem.push(itemIndex);
  });

  const words = normalize(highlightText).trim().split(' ').filter(Boolean);
  let matchStart = -1;
  let matchLength = 0;
  for (const wordCount of [20, 14, 10, 6]) {
    if (words.length < wordCount) continue;
    const needle = words.slice(0, wordCount).join(' ');
    matchStart = haystack.indexOf(needle);
    if (matchStart !== -1) {
      matchLength = needle.length;
      break;
    }
  }
  if (matchStart === -1) return;

  const matchedItemIndexes = new Set<number>();
  for (let i = matchStart; i < matchStart + matchLength && i < offsetToItem.length; i++) {
    matchedItemIndexes.add(offsetToItem[i]);
  }
  for (const itemIndex of matchedItemIndexes) {
    textDivs[itemIndex]?.classList.add('pdf-highlight');
  }
}
