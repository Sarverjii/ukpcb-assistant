'use client';

import { useEffect, useState } from 'react';
import { X, FileText, Globe, ExternalLink, Presentation } from 'lucide-react';
import { getCitationPreviewAction } from '@/app/(chat)/chat/actions';
import { PdfPageViewer } from '@/components/chat/PdfPageViewer';

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      content: string;
      documentId: string;
      pageNumber: number | null;
      previewable: boolean;
      unit: 'page' | 'slide';
      sourceUrl: string | null;
    };

// Modal (not an anchored popover) deliberately — a chip's on-screen position
// varies with message length and viewport width, and a fixed-position
// dialog needs no anchoring math and works identically on mobile, where a
// popover next to a small inline chip would often clip off-screen.
export function CitationPreviewModal({
  chunkId,
  documentName,
  onClose,
}: {
  chunkId: string;
  documentName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  // Best-effort text matching (PdfPageViewer) doesn't always find the
  // cited passage on the rendered page — the caption at the bottom
  // shouldn't claim something was highlighted when it wasn't.
  const [highlightFound, setHighlightFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // No reset-to-loading here: ChatPanel only ever renders one instance of
    // this component at a time, conditionally (`{previewCitation && ...}`)
    // — closing and reopening on a different citation unmounts and
    // remounts it, so state already starts at 'loading' on every genuinely
    // new chunkId. Resetting here too would just be redundant.
    getCitationPreviewAction(chunkId).then((result) => {
      if (cancelled) return;
      setState(
        'error' in result
          ? { status: 'error', message: result.error }
          : {
              status: 'ready',
              content: result.content,
              documentId: result.documentId,
              pageNumber: result.pageNumber,
              previewable: result.previewable,
              unit: result.unit,
              sourceUrl: result.sourceUrl,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [chunkId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // A page render only happens once we actually know which page — a PDF
  // chunk from before this app tracked page numbers (pre-migration) has
  // none, and showing page 1 in that case would be actively misleading
  // (confidently wrong) rather than merely incomplete, so it falls back to
  // the text passage instead, same as a genuinely unsupported format.
  const canRenderPage = state.status === 'ready' && state.previewable && state.pageNumber != null;
  const viewUrl = state.status === 'ready' ? `/api/documents/${state.documentId}/view` : null;
  const internalOpenUrl = state.status === 'ready' && state.pageNumber ? `${viewUrl}#page=${state.pageNumber}` : viewUrl;
  // A website-sourced citation opens the REAL live page, not the
  // internally generated PDF rendition of its scraped HTML — that
  // rendition exists so the passage can still be shown/highlighted here,
  // but it's not what "open this" should mean for something that has an
  // actual source URL. sourceUrl is only ever set for that kind of
  // document (see ChunkForUser's own comment).
  const sourceUrl = state.status === 'ready' ? state.sourceUrl : null;
  const openUrl = sourceUrl ?? internalOpenUrl;
  let sourceHostname: string | null = null;
  if (sourceUrl) {
    try {
      sourceHostname = new URL(sourceUrl).hostname;
    } catch {
      sourceHostname = null;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 shadow-2xl ring-1 ring-black/5 transition-[max-width] ${
          canRenderPage ? 'max-w-3xl' : 'max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
              {sourceUrl ? <Globe size={14} /> : <FileText size={14} />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{documentName}</p>
              {sourceHostname ? (
                <p className="truncate text-xs text-zinc-400">{sourceHostname}</p>
              ) : (
                state.status === 'ready' &&
                state.pageNumber && (
                  <p className="text-xs text-zinc-400">
                    {state.unit === 'slide' ? `Slide ${state.pageNumber}` : `Page ${state.pageNumber}`}
                  </p>
                )
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950"
              >
                {sourceUrl ? 'View live page' : 'Open full document'}
                <ExternalLink size={12} />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-zinc-400">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500 dark:border-zinc-700" />
            Loading cited passage…
          </div>
        )}
        {state.status === 'error' && (
          <div className="px-5 py-6 text-sm text-red-600 dark:text-red-400">{state.message}</div>
        )}

        {canRenderPage && state.status === 'ready' && viewUrl && (
          <>
            <div className="overflow-y-auto">
              <PdfPageViewer
                url={viewUrl}
                pageNumber={state.pageNumber!}
                highlightText={state.content}
                onHighlightResult={setHighlightFound}
              />
            </div>
            <div className="flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800 px-5 py-2.5 text-xs text-zinc-400">
              {highlightFound ? (
                <>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-amber-300/70" />
                  Highlighted text is what this answer actually cited.
                </>
              ) : (
                <span>This is the page the answer was drawn from.</span>
              )}
            </div>
          </>
        )}

        {state.status === 'ready' && !canRenderPage && (
          <>
            <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              <p className="whitespace-pre-wrap">{state.content}</p>
            </div>
            <div className="flex items-start gap-2 border-t border-zinc-100 dark:border-zinc-800 px-5 py-2.5 text-xs text-zinc-400">
              {sourceUrl ? <Globe size={13} className="mt-0.5 shrink-0" /> : <Presentation size={13} className="mt-0.5 shrink-0" />}
              <span>
                {sourceUrl ? (
                  <>
                    This is the exact passage the answer was drawn from, re-checked against your
                    current access. Use <span className="font-medium">View live page</span> to see
                    it on the actual site — the page may have changed since this was indexed.
                  </>
                ) : (
                  <>
                    This is the exact passage the answer was drawn from, re-checked against your
                    current access. A page preview isn&apos;t available for this particular
                    citation — use <span className="font-medium">Open full document</span> to see
                    it in context.
                  </>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
