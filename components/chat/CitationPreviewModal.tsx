'use client';

import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { getCitationPreviewAction } from '@/app/(chat)/chat/actions';

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
  const [state, setState] = useState<{ content: string } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No reset-to-null here: ChatPanel only ever renders one instance of
    // this component at a time, conditionally (`{previewCitation && ...}`)
    // — closing and reopening on a different citation unmounts and
    // remounts it, so state already starts at null on every genuinely new
    // chunkId. Resetting here too would just be redundant.
    getCitationPreviewAction(chunkId).then((result) => {
      if (cancelled) return;
      setState('error' in result ? { error: result.error } : { content: result.content });
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={15} className="shrink-0 text-zinc-400" />
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-white">{documentName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {state === null && <p className="text-zinc-400">Loading cited passage…</p>}
          {state && 'error' in state && <p className="text-red-600 dark:text-red-400">{state.error}</p>}
          {state && 'content' in state && <p className="whitespace-pre-wrap">{state.content}</p>}
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-400">
          This is the exact passage the answer was drawn from, re-checked against your current access.
        </div>
      </div>
    </div>
  );
}
