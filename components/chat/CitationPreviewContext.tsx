'use client';

import { createContext, useContext, useState } from 'react';
import { CitationPreviewModal } from '@/components/chat/CitationPreviewModal';

export type Citation = {
  documentId: string;
  documentName: string;
  chunkId: string;
  // Set only for a citation whose source chunk came from a pasted URL —
  // see lib/rag/chat.ts's Citation type (this is its client-side mirror,
  // carried verbatim through the SSE "done" event and the stored Message
  // row). Lets the citation chip render as a plain link to the real page
  // instead of opening this preview modal.
  sourceUrl: string | null;
};

type CitationPreviewContextValue = {
  openCitation: (citation: Citation) => void;
};

const CitationPreviewContext = createContext<CitationPreviewContextValue | null>(null);

/**
 * Mounted once at the (chat) layout level (see ChatShell), ABOVE the
 * /chat (draft) vs /chat/[id] (real conversation) route boundary — not
 * inside ChatPanel, where this modal's open/closed state used to live.
 *
 * A brand-new conversation's first message finishing triggers a client-
 * side navigation from the draft route to its real one: two different
 * page.tsx files, so React remounts everything below this layout on that
 * swap regardless of any key-prop tuning on either page (confirmed
 * directly against production, not assumed — clicking a citation on a
 * conversation's very first answer, an extremely common thing to do
 * right after getting one, silently closed the preview modal before the
 * page had even finished rendering it, every single time). Living up
 * here instead means that swap only remounts the chat transcript
 * underneath; the modal itself, and whether one is currently open, is
 * unaffected by it.
 */
export function CitationPreviewProvider({ children }: { children: React.ReactNode }) {
  const [citation, setCitation] = useState<Citation | null>(null);

  return (
    <CitationPreviewContext.Provider value={{ openCitation: setCitation }}>
      {children}
      {citation && (
        <CitationPreviewModal
          chunkId={citation.chunkId}
          documentName={citation.documentName}
          onClose={() => setCitation(null)}
        />
      )}
    </CitationPreviewContext.Provider>
  );
}

export function useCitationPreview(): CitationPreviewContextValue {
  const ctx = useContext(CitationPreviewContext);
  if (!ctx) throw new Error('useCitationPreview must be used within CitationPreviewProvider');
  return ctx;
}
