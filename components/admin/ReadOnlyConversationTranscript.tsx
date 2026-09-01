'use client';

import { Markdown } from '@/components/chat/Markdown';
import { useCitationPreview, type Citation } from '@/components/chat/CitationPreviewContext';

export type ReadOnlyMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations?: Citation[];
};

/**
 * A static, non-interactive rendering of one conversation — for the admin
 * "view an employee's conversation" page. Deliberately NOT a readOnly-prop
 * retrofit of ChatPanel/MessageBlock: that component carries streaming-
 * cursor state, optimistic local- id handling, and Copy/Regenerate/
 * feedback wiring that would all need prop-gating off for no benefit here.
 * This reuses only what's actually shared — Markdown rendering and the
 * citation-chip-button pattern (still clickable: reading a source isn't a
 * mutation, so it stays available even in a read-only view) — with no
 * input bar and no per-message action row at all.
 */
export function ReadOnlyConversationTranscript({
  employeeName,
  title,
  messages,
}: {
  employeeName: string;
  title: string | null;
  messages: ReadOnlyMessage[];
}) {
  const { openCitation } = useCitationPreview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{employeeName}&apos;s conversation</p>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">{title || 'Untitled conversation'}</h1>
      </div>

      <div className="flex flex-col gap-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-6">
        {messages.map((m) =>
          m.role === 'USER' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-2">
              <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                <Markdown>{m.content}</Markdown>
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.citations.map((c) => (
                    <button
                      key={c.chunkId}
                      type="button"
                      onClick={() => openCitation(c)}
                      title={`Preview cited passage from ${c.documentName}`}
                      className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      {c.documentName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {messages.length === 0 && <p className="text-sm text-zinc-400">No messages in this conversation.</p>}
      </div>
    </div>
  );
}
