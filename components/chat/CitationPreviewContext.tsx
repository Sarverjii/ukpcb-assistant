'use client';

import { createContext, useContext, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { getCitationPreviewAction } from '@/app/(chat)/chat/actions';

export type Citation = {
  documentId: string;
  documentName: string;
  chunkId: string;
  // Set only for a citation whose source chunk came from a pasted URL —
  // see lib/rag/chat.ts's Citation type (this is its client-side mirror,
  // carried verbatim through the SSE "done" event and the stored Message
  // row). Opens the real live page directly rather than this app's own
  // internal PDF rendition of it.
  sourceUrl: string | null;
};

type CitationPreviewContextValue = {
  openCitation: (citation: Citation) => void;
};

const CitationPreviewContext = createContext<CitationPreviewContextValue | null>(null);

/**
 * Mounted once at the (chat) layout level (see ChatShell), ABOVE the
 * /chat (draft) vs /chat/[id] (real conversation) route boundary — kept
 * from an earlier version of this provider that held a preview modal's
 * open/closed state here for the same reason: a brand-new conversation's
 * first message finishing navigates from the draft route to its real one
 * (two different page.tsx files), remounting everything below this
 * layout — living up here means that swap can't interrupt whatever this
 * provider is in the middle of.
 *
 * Clicking a citation used to open an in-page modal with a "open full
 * document" link buried inside it — changed directly on request to open
 * the actual source document in a new tab immediately, at the cited page,
 * with no intermediate step. getCitationPreviewAction still runs first
 * and is NOT skippable: it re-checks the caller's current clearance
 * against the cited chunk (a citation in an old conversation can
 * reference content the viewer no longer has access to) and is what
 * looks up the real page number and CITATION_PREVIEWED-audits the view —
 * none of that can be inferred client-side from the Citation chip alone,
 * which carries no page number. Only a genuine failure (access revoked,
 * chunk deleted since) surfaces anything in-page at all, as a small
 * dismissable toast rather than a blocking modal, since the common case
 * now never needs any in-page UI to begin with.
 */
export function CitationPreviewProvider({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<{ documentName: string; message: string } | null>(null);

  function openCitation(citation: Citation) {
    setError(null);
    getCitationPreviewAction(citation.chunkId).then((result) => {
      if ('error' in result) {
        setError({ documentName: citation.documentName, message: result.error });
        return;
      }
      const viewUrl = `/api/documents/${result.documentId}/view`;
      const internalOpenUrl = result.pageNumber ? `${viewUrl}#page=${result.pageNumber}` : viewUrl;
      const openUrl = result.sourceUrl ?? internalOpenUrl;
      window.open(openUrl, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <CitationPreviewContext.Provider value={{ openCitation }}>
      {children}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-zinc-900 px-4 py-3 text-sm shadow-lg">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900 dark:text-white">{error.documentName}</p>
            <p className="text-zinc-600 dark:text-zinc-400">{error.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="ml-1 shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </CitationPreviewContext.Provider>
  );
}

export function useCitationPreview(): CitationPreviewContextValue {
  const ctx = useContext(CitationPreviewContext);
  if (!ctx) throw new Error('useCitationPreview must be used within CitationPreviewProvider');
  return ctx;
}
