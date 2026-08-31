'use client';

import { useEffect, useState } from 'react';
import { X, FileText, ExternalLink, Presentation } from 'lucide-react';
import { getCitationPreviewAction } from '@/app/(chat)/chat/actions';

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      content: string;
      documentId: string;
      pageNumber: number | null;
      previewable: boolean;
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

  // PDFs get a much wider modal to fit an actual embedded page; the
  // text-only fallback (no native in-browser renderer for DOCX/PPTX/etc.)
  // stays at the original, narrower reading-width size.
  const isPdfPreview = state.status === 'ready' && state.previewable;
  const viewUrl =
    state.status === 'ready'
      ? `/api/documents/${state.documentId}/view${state.pageNumber ? `#page=${state.pageNumber}` : ''}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl transition-[max-width] ${
          isPdfPreview ? 'max-w-3xl' : 'max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={15} className="shrink-0 text-zinc-400" />
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-white">{documentName}</span>
            {state.status === 'ready' && state.pageNumber && (
              <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {state.previewable ? `Page ${state.pageNumber}` : `Slide ${state.pageNumber}`}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {viewUrl && (
              <a
                href={viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Open full document
                <ExternalLink size={12} />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="px-4 py-4 text-sm text-zinc-400">Loading cited passage…</div>
        )}
        {state.status === 'error' && (
          <div className="px-4 py-4 text-sm text-red-600 dark:text-red-400">{state.message}</div>
        )}

        {state.status === 'ready' && state.previewable && viewUrl && (
          <>
            <iframe
              src={viewUrl}
              title={`${documentName} preview`}
              className="h-[65vh] w-full border-0 bg-zinc-100 dark:bg-zinc-950"
            />
            <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-400">
              Showing the page this answer cited — scroll or use{' '}
              <span className="font-medium">Open full document</span> to read the rest.
            </div>
          </>
        )}

        {state.status === 'ready' && !state.previewable && (
          <>
            <div className="overflow-y-auto px-4 py-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              <p className="whitespace-pre-wrap">{state.content}</p>
            </div>
            <div className="flex items-start gap-2 border-t border-zinc-100 dark:border-zinc-800 px-4 py-2.5 text-xs text-zinc-400">
              <Presentation size={13} className="mt-0.5 shrink-0" />
              <span>
                This is the exact passage the answer was drawn from, re-checked against your current
                access. An in-browser preview isn&apos;t available for this file type — use{' '}
                <span className="font-medium">Open full document</span> to see it in context.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
