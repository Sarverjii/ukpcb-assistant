'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, UploadCloud, X, XCircle } from 'lucide-react';
import { submitFile, pollUntilSettled, stripExtension } from '@/lib/documents/uploadClient';

export type QueueItemStatus = 'queued' | 'uploading' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export type QueueItem = {
  key: string;
  fileName: string;
  fileSize: number;
  status: QueueItemStatus;
  error?: string;
};

type StartParams = {
  files: File[];
  clearanceLevel: number;
  department?: string;
  useClientUpload: boolean;
};

type UploadQueueContextValue = {
  items: QueueItem[];
  isRunning: boolean;
  /** Starts a new bulk batch. A no-op while one is already running — this
   * app deliberately processes one file at a time (concurrent embedding
   * calls hit real rate limits earlier on), so a second batch has to wait
   * for the first to fully settle before starting, same as before. */
  start: (params: StartParams) => void;
  /** Drops the finished batch's entries so the upload UI resets to a blank
   * picker. Only meaningful once every item has settled. */
  clear: () => void;
};

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

function keyOf(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Mounted once at the true app root (app/layout.tsx). This matters
 * because `/knowledge-base` and `/chat` sit in separate route groups
 * ((app) and (chat)) with their own independent layouts — navigating
 * between them unmounts everything below the root, including whatever
 * page-local state was tracking a bulk upload's progress. That's exactly
 * what caused a real 47-file batch to lose track of every file it hadn't
 * reached yet the moment the user clicked back to chat mid-upload: the
 * sequential submit loop lived inside the Knowledge Base page's own
 * component tree, so unmounting it correctly stopped everything, in-flight
 * file included.
 *
 * Living at the root instead means the loop below keeps running across
 * any in-app navigation for as long as the tab stays open. The one thing
 * this does not cover is a hard refresh or closing the tab — that would
 * still lose track of files the loop hadn't reached yet (anything that
 * already became a real Document row is safe regardless, since that's
 * server state, not this queue).
 */
export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const runningRef = useRef(false);

  const updateItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const start = useCallback(
    (params: StartParams) => {
      if (runningRef.current || params.files.length === 0) return;
      runningRef.current = true;
      setIsRunning(true);
      setDismissed(false);
      setItems(
        params.files.map((f) => ({ key: keyOf(f), fileName: f.name, fileSize: f.size, status: 'queued' as const })),
      );

      (async () => {
        // Sequential, not parallel — one file fully reaches READY/FAILED
        // before the next one starts uploading, same reasoning as before
        // this queue moved up here.
        for (const file of params.files) {
          const key = keyOf(file);
          updateItem(key, { status: 'uploading' });
          const result = await submitFile(
            file,
            { name: stripExtension(file.name), clearanceLevel: params.clearanceLevel, department: params.department },
            params.useClientUpload,
          );
          if ('error' in result) {
            updateItem(key, { status: 'FAILED', error: result.error });
            continue;
          }
          updateItem(key, { status: result.status as QueueItemStatus });
          await pollUntilSettled(result.id, (s, procError) => {
            updateItem(key, { status: s as QueueItemStatus, error: procError });
          });
        }
        runningRef.current = false;
        setIsRunning(false);
      })();
    },
    [updateItem],
  );

  const clear = useCallback(() => {
    setItems([]);
    setDismissed(false);
  }, []);

  return (
    <UploadQueueContext.Provider value={{ items, isRunning, start, clear }}>
      {children}
      {items.length > 0 && !dismissed && (
        <UploadQueueIndicator items={items} isRunning={isRunning} onDismiss={() => setDismissed(true)} />
      )}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): UploadQueueContextValue {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error('useUploadQueue must be used within UploadQueueProvider');
  return ctx;
}

/**
 * A small fixed-position card rendered by the provider itself, so it's on
 * screen from every route — not just Knowledge Base — whenever a batch is
 * running or has just finished. This is what makes "still uploading"
 * visible while the user has navigated elsewhere, instead of the progress
 * silently continuing off-screen with nothing on screen to show for it.
 */
function UploadQueueIndicator({
  items,
  isRunning,
  onDismiss,
}: {
  items: QueueItem[];
  isRunning: boolean;
  onDismiss: () => void;
}) {
  const doneCount = items.filter((it) => it.status === 'READY' || it.status === 'FAILED').length;
  const failedCount = items.filter((it) => it.status === 'FAILED').length;
  const total = items.length;
  const allSettled = doneCount === total;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
      <div className="flex items-center gap-2.5 border-b border-zinc-100 dark:border-zinc-800 px-3.5 py-2.5">
        {isRunning ? (
          <Loader2 size={15} className="shrink-0 animate-spin text-brand-600" />
        ) : failedCount > 0 ? (
          <XCircle size={15} className="shrink-0 text-red-500" />
        ) : (
          <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-zinc-900 dark:text-white">
            {isRunning ? `Uploading documents… ${doneCount}/${total}` : `Upload finished — ${doneCount}/${total} done`}
          </p>
          {!isRunning && failedCount > 0 && <p className="text-xs text-red-500">{failedCount} failed</p>}
        </div>
        {allSettled && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Link
        href="/knowledge-base"
        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-brand-600 hover:bg-zinc-50 dark:hover:bg-zinc-800"
      >
        <UploadCloud size={13} /> View in Knowledge Base
      </Link>
    </div>
  );
}
