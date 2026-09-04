'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Copy, Check, RotateCw, Download, ChevronDown, FileText, FileDown, ThumbsUp, ThumbsDown, Pencil, Paperclip, X, ExternalLink, Search } from 'lucide-react';
import { streamChat } from '@/components/chat/streamChat';
import { Markdown } from '@/components/chat/Markdown';
import { useCitationPreview, type Citation } from '@/components/chat/CitationPreviewContext';
import { downloadConversationMarkdown, exportConversationAsPdf } from '@/components/chat/exportConversation';
import { LAST_CONVERSATION_STORAGE_KEY } from '@/lib/lastConversation';
import { setMessageFeedbackAction } from '@/app/(chat)/chat/actions';

export type { Citation };
export type MessageFeedback = 'UP' | 'DOWN';
export type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations?: Citation[];
  feedback?: MessageFeedback | null;
  editedAt?: string | null;
};

type AvailableDocument = { id: string; name: string };

export function ChatPanel({
  conversationId,
  initialMessages,
  initialTitle,
  availableDocuments,
}: {
  // null = the stateless "/chat" draft — no conversation exists yet.
  conversationId: string | null;
  initialMessages: ChatMessage[];
  initialTitle: string | null;
  // Every document this viewer is cleared to see, for the composer's
  // "scope to document(s)" picker (Feature 3) — id/name is all it needs.
  availableDocuments: AvailableDocument[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The message currently receiving stream deltas — drives the "still
  // generating" cursor/indicator and disables its own action row until the
  // answer is actually final. Distinct from `pending`, which also covers
  // the moment between clicking send and the first token arriving.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // Documents the next question should be scoped to — cleared after every
  // send, same "picked per-question, not sticky" behavior a scope picker
  // implies. Not carried into regenerate or edit (see streamChat's own
  // comment on why regenerate can't carry it).
  const [scopedDocumentIds, setScopedDocumentIds] = useState<string[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  // Cleared whenever the picker closes (see the outside-click/Escape
  // effect below) so reopening it always starts from the full list rather
  // than whatever was typed last time — this corpus runs to the hundreds
  // of documents, where scrolling a flat unfiltered list to find one by
  // name stopped being practical.
  const [docSearch, setDocSearch] = useState('');
  const { openCitation } = useCitationPreview();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const docPickerRef = useRef<HTMLDivElement>(null);
  // Starts at 0 (not messages.length) specifically so the very first
  // effect run after mount still sees "length increased" and lands the
  // view at the bottom of an existing conversation, same as before this
  // ref-based guard existed.
  const prevMessagesLengthRef = useRef(0);
  // A plain incrementing counter, not Date.now()/crypto.randomUUID() — this
  // function (handleEditMessage) also reads `messages` directly rather than
  // only through a setState updater's `prev`, and the two combined trips
  // react-hooks/purity's "impure call" check even though this only ever
  // runs from a click handler. A ref-backed counter sidesteps the question
  // entirely (still guaranteed unique within this component instance) and
  // needs no such workaround.
  const localIdCounter = useRef(0);
  function nextLocalId(prefix: 'local-user' | 'local-assistant'): string {
    localIdCounter.current += 1;
    return `${prefix}-${localIdCounter.current}`;
  }

  // Was unconditional on every `messages` change — which also fires for an
  // in-place content update to an EXISTING message (regenerate/edit both
  // work by mutating one message's content, not appending), so
  // regenerating an older reply yanked the view down to the bottom on the
  // very first delta, then kept doing it on every subsequent delta as the
  // new answer streamed in. Auto-scrolling now only follows two cases
  // that actually warrant it: a brand-new message was appended (length
  // increased — a real send, or a fresh follow-up), or the message
  // currently streaming IS the last one in the list (regenerating/editing
  // the most recent reply, where staying pinned to the bottom is still the
  // expected "watch it type" behavior). Regenerating anything earlier in
  // the conversation now leaves the scroll position exactly where the
  // reader put it.
  useEffect(() => {
    const lengthIncreased = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
    const streamingIsLastMessage = streamingId !== null && lastMessage?.id === streamingId;
    if (lengthIncreased || streamingIsLastMessage) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingId]);

  // Focuses the composer on first load and every remount (a fresh page
  // load, or navigating to a different conversation — ChatPanel is
  // remounted via key={conversation.id}, see app/(chat)/chat/[id]/page.tsx)
  // so typing can start immediately without clicking into the box first.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // The scope-document picker previously had no reliable way to close once
  // open (the trigger button toggles it, but with a long document list the
  // only other close point was a link at the very bottom of a scrolling
  // list — easy to never reach). Closing on an outside click or Escape,
  // same as ExportMenu's dropdown below, fixes that regardless of list
  // length or scroll position.
  // Closes the picker AND clears whatever was searched — every close path
  // (outside click, Escape, the explicit X button) goes through this one
  // function so reopening always starts from the full list rather than
  // wherever the last search left off.
  function closeDocPicker() {
    setShowDocPicker(false);
    setDocSearch('');
  }

  useEffect(() => {
    if (!showDocPicker) return;
    function handleClick(e: MouseEvent) {
      if (docPickerRef.current && !docPickerRef.current.contains(e.target as Node)) closeDocPicker();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDocPicker();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showDocPicker]);

  useEffect(() => {
    // Records the last real conversation viewed so "Back to chat" from
    // Admin/Settings/Upload (BackToChatLink.tsx) can return here instead of
    // always resetting to a blank draft. Covers every way this component
    // ends up showing a real conversation (direct link, sidebar click,
    // browser back/forward, a brand-new send that navigates here) since
    // they all mount ChatPanel with a non-null conversationId.
    if (!conversationId) return;
    try {
      localStorage.setItem(LAST_CONVERSATION_STORAGE_KEY, conversationId);
    } catch {
      // Unavailable (private browsing, blocked storage) — BackToChatLink
      // just falls back to "/chat" in that case, no functional loss.
    }
  }, [conversationId]);

  function appendDelta(messageId: string, text: string) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: m.content + text } : m)));
  }

  function appendStreamError(messageId: string, message: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, content: `${m.content}${m.content ? '\n\n' : ''}⚠️ ${message}` } : m,
      ),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    setError(null);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMessageId = `local-user-${Date.now()}`;
    const assistantMessageId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: 'USER', content: question },
      { id: assistantMessageId, role: 'ASSISTANT', content: '' },
    ]);
    setStreamingId(assistantMessageId);
    const scopeForThisSend = scopedDocumentIds.length > 0 ? scopedDocumentIds : undefined;
    setScopedDocumentIds([]);

    startTransition(async () => {
      try {
        await streamChat({ conversationId, question, scopedDocumentIds: scopeForThisSend }, (event) => {
          if (event.type === 'delta') {
            appendDelta(assistantMessageId, event.text);
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === assistantMessageId) return { ...m, id: event.messageId, citations: event.citations };
                // Swaps the local placeholder id for the real one as soon as
                // it exists, so Edit (gated on !id.startsWith('local-'))
                // becomes available on this message right away instead of
                // only after a reload.
                if (m.id === userMessageId && event.userMessageId) return { ...m, id: event.userMessageId };
                return m;
              }),
            );
            if (!conversationId) {
              // This was the draft ("/chat") state — the conversation now
              // exists. Swap the URL to it (replace, not push, so the back
              // button doesn't land back on an empty draft), and refresh
              // so the (chat) layout's Sidebar (a shared layout segment
              // that stays mounted across this navigation) picks up the
              // brand-new conversation instead of showing what it fetched
              // on the previous page load.
              router.replace(`/chat/${event.conversationId}`);
            }
            router.refresh();
          } else if (event.type === 'error') {
            appendStreamError(assistantMessageId, event.message);
          }
        });
      } catch {
        setError('Something went wrong answering that. Please try again.');
      } finally {
        setStreamingId(null);
        // Back in the composer after every exchange — sending, regenerating,
        // or editing all end here, and typing the next question shouldn't
        // require clicking back into the box first.
        textareaRef.current?.focus();
      }
    });
  }

  function handleRegenerate(messageId: string) {
    // Only ever reachable from an existing assistant message's Regenerate
    // button, which can't render before a conversation (and conversationId)
    // exists — this guard is just for TypeScript's narrowing, not a real
    // runtime path.
    if (!conversationId || pending) return;
    setError(null);
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: '', citations: undefined } : m)));
    setStreamingId(messageId);

    startTransition(async () => {
      try {
        await streamChat({ conversationId, regenerateMessageId: messageId }, (event) => {
          if (event.type === 'delta') {
            appendDelta(messageId, event.text);
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, id: event.messageId, citations: event.citations } : m)),
            );
            router.refresh();
          } else if (event.type === 'error') {
            appendStreamError(messageId, event.message);
          }
        });
      } catch {
        setError('Could not regenerate that answer. Please try again.');
      } finally {
        setStreamingId(null);
        // Back in the composer after every exchange — sending, regenerating,
        // or editing all end here, and typing the next question shouldn't
        // require clicking back into the box first.
        textareaRef.current?.focus();
      }
    });
  }

  // Edits message `messageId` in place and wipes everything after it —
  // mirrors handleRegenerate's shape (splice, set streamingId, stream, then
  // reconcile the placeholder id on `done`), just with two differences: the
  // edited message's own content changes too, and every message after it
  // (not just one assistant reply) is dropped from local state, matching
  // exactly what the server side does (see the route's editMessageId mode).
  function handleEditMessage(messageId: string, newContent: string) {
    if (!conversationId || pending) return;
    const targetIndex = messages.findIndex((m) => m.id === messageId);
    if (targetIndex === -1) return;

    setError(null);
    const assistantMessageId = nextLocalId('local-assistant');
    setMessages((prev) => [
      ...prev.slice(0, targetIndex),
      // A client-only "yes, this was just edited" marker — the real
      // editedAt timestamp lives server-side; this just needs to be
      // truthy so the "(edited)" label renders immediately rather than
      // waiting for a reload. Not Date.now()-based, for the same
      // react-hooks/purity reason nextLocalId exists.
      { ...prev[targetIndex], content: newContent, editedAt: 'just now' },
      { id: assistantMessageId, role: 'ASSISTANT', content: '' },
    ]);
    setStreamingId(assistantMessageId);

    startTransition(async () => {
      try {
        await streamChat({ conversationId, editMessageId: messageId, content: newContent }, (event) => {
          if (event.type === 'delta') {
            appendDelta(assistantMessageId, event.text);
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, id: event.messageId, citations: event.citations } : m,
              ),
            );
            router.refresh();
          } else if (event.type === 'error') {
            appendStreamError(assistantMessageId, event.message);
          }
        });
      } catch {
        setError('Could not save that edit. Please try again.');
      } finally {
        setStreamingId(null);
        // Back in the composer after every exchange — sending, regenerating,
        // or editing all end here, and typing the next question shouldn't
        // require clicking back into the box first.
        textareaRef.current?.focus();
      }
    });
  }

  // Optimistic, with rollback on a failed server action — matches how
  // citations/content are already lifted into this component's `messages`
  // state rather than kept local to MessageBlock, so feedback survives a
  // MessageBlock remount and stays visible after a reload (threaded from
  // initialMessages, see app/(chat)/chat/[id]/page.tsx). Toggle-vs-set is
  // decided here (the caller already knows the message's current value),
  // not on the server — setMessageFeedbackAction stays a blind write.
  //
  // Deliberately NOT the same startTransition/pending used for send and
  // regenerate above — those gate the composer and Regenerate button on
  // "is a real answer in flight"; a feedback click is independent of that
  // and shouldn't disable them while it round-trips.
  function handleFeedback(messageId: string, next: MessageFeedback | null) {
    const previous = messages.find((m) => m.id === messageId)?.feedback ?? null;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: next } : m)));
    void setMessageFeedbackAction(messageId, next).then((result) => {
      if (result.error) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: previous } : m)));
      }
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  // The corpus this filters over runs to the hundreds of documents — cheap
  // enough to recompute on every render (a plain client-side name filter,
  // same reasoning DocumentsTable/EmployeesTable already use for their own
  // search boxes) without memoizing.
  const filteredDocuments = availableDocuments.filter((doc) =>
    doc.name.toLowerCase().includes(docSearch.trim().toLowerCase()),
  );

  const inputBar = (
    <>
      {availableDocuments.length > 0 && (
        <div ref={docPickerRef} className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => (showDocPicker ? closeDocPicker() : setShowDocPicker(true))}
            className="flex items-center gap-1 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
          >
            <Paperclip size={11} />
            {scopedDocumentIds.length > 0 ? `Scoped to ${scopedDocumentIds.length}` : 'Scope to document(s)'}
          </button>
          {scopedDocumentIds.map((id) => {
            const doc = availableDocuments.find((d) => d.id === id);
            if (!doc) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-950 px-2.5 py-1 text-xs text-brand-700 dark:text-brand-300"
              >
                {doc.name}
                <button
                  type="button"
                  onClick={() => setScopedDocumentIds((prev) => prev.filter((x) => x !== id))}
                  aria-label={`Remove ${doc.name} from scope`}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
          {showDocPicker && (
            <div className="relative w-full">
              <div className="absolute bottom-full z-10 mb-2 w-full max-w-xs overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-3 py-2">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Scope to document(s)</span>
                  <button
                    type="button"
                    onClick={closeDocPicker}
                    aria-label="Close"
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 px-3 py-1.5">
                  <Search size={13} className="shrink-0 text-zinc-400" />
                  <input
                    type="text"
                    autoFocus
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    placeholder="Search documents…"
                    className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {filteredDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        setScopedDocumentIds((prev) =>
                          prev.includes(doc.id) ? prev.filter((x) => x !== doc.id) : [...prev, doc.id],
                        );
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        scopedDocumentIds.includes(doc.id) ? 'text-brand-700 dark:text-brand-300' : 'text-zinc-700 dark:text-zinc-200'
                      }`}
                    >
                      {doc.name}
                      {scopedDocumentIds.includes(doc.id) && <Check size={13} />}
                    </button>
                  ))}
                  {filteredDocuments.length === 0 && (
                    <p className="px-3 py-2 text-sm text-zinc-400">No documents match &ldquo;{docSearch}&rdquo;.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 shadow-sm focus-within:border-zinc-300 dark:focus-within:border-zinc-600"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          rows={1}
          placeholder="Message Evon…"
          className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 dark:bg-brand-600 text-white disabled:opacity-30 transition-opacity"
          aria-label="Send"
        >
          <ArrowUp size={16} />
        </button>
      </form>
      <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-zinc-400">
        Ask Evon answers only from documents your role is cleared to see.
      </p>
    </>
  );

  if (messages.length === 0) {
    // Greeting + input grouped as one vertically-centered unit, rather than
    // the greeting centered in a tall empty scroll area with the input
    // pinned far below it — that split reads as an unfinished, overly
    // empty page rather than an intentional "ready to start" state.
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">Ask Evon</h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            What would you like to know about the company?
          </p>
        </div>
        <div className="w-full max-w-3xl">{inputBar}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {conversationId && (
        <div className="flex justify-end border-b border-zinc-100 dark:border-zinc-800 px-4 py-2">
          <ExportMenu title={initialTitle || 'Conversation'} messages={messages} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
          {messages.map((m, i) => (
            <MessageBlock
              key={m.id}
              message={m}
              isLastAssistant={m.role === 'ASSISTANT' && i === messages.length - 1 && !pending}
              isStreaming={m.id === streamingId}
              onRegenerate={
                m.role === 'ASSISTANT' && !m.id.startsWith('local-') && !pending
                  ? () => handleRegenerate(m.id)
                  : undefined
              }
              onFeedbackChange={
                m.role === 'ASSISTANT' && !m.id.startsWith('local-')
                  ? (next) => handleFeedback(m.id, next)
                  : undefined
              }
              onEdit={
                m.role === 'USER' && !m.id.startsWith('local-') && !pending
                  ? (content) => handleEditMessage(m.id, content)
                  : undefined
              }
              onCitationClick={openCitation}
            />
          ))}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-6">{inputBar}</div>
    </div>
  );
}

function ExportMenu({ title, messages }: { title: string; messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Nothing to export yet — nothing but transient local- placeholder rows.
  const exportable = messages.some((m) => !m.id.startsWith('local-'));
  if (!exportable) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
      >
        <Download size={13} />
        Export
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              downloadConversationMarkdown(title, messages);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <FileText size={14} /> Markdown (.md)
          </button>
          <button
            type="button"
            onClick={() => {
              exportConversationAsPdf(title, messages);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <FileDown size={14} /> PDF (print dialog)
          </button>
        </div>
      )}
    </div>
  );
}

function MessageBlock({
  message,
  isLastAssistant,
  isStreaming,
  onRegenerate,
  onFeedbackChange,
  onEdit,
  onCitationClick,
}: {
  message: ChatMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onFeedbackChange?: (feedback: MessageFeedback | null) => void;
  onEdit?: (newContent: string) => void;
  onCitationClick: (citation: Citation) => void;
}) {
  const isUser = message.role === 'USER';
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silently no-op
    }
  }

  if (isUser) {
    if (isEditing) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] sm:max-w-[75%] rounded-2xl border border-brand-300 dark:border-brand-700 bg-white dark:bg-zinc-900 p-2.5">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(8, draft.split('\n').length + 1)}
              className="w-full resize-none bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setIsEditing(false);
                }}
                className="rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!draft.trim() || draft.trim() === message.content}
                onClick={() => {
                  setIsEditing(false);
                  onEdit?.(draft.trim());
                }}
                className="rounded-md bg-brand-700 dark:bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Save &amp; regenerate
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <div className="flex items-center gap-2 pr-1 text-xs text-zinc-400">
          {message.editedAt && <span>(edited)</span>}
          {onEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(message.content);
                setIsEditing(true);
              }}
              className="flex items-center gap-1 opacity-0 group-hover:opacity-100 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Pencil size={11} />
              Edit
            </button>
          )}
        </div>
      </div>
    );
  }

  // Nothing has streamed in yet — show the "still working" indicator in
  // place of an empty Markdown block instead of a blank gap.
  if (isStreaming && message.content.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <div className="flex items-center gap-1">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </div>
        Reading your authorized documents…
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-2">
      <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        <Markdown>{message.content}</Markdown>
        {isStreaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-zinc-400 dark:bg-zinc-500 align-middle" />
        )}
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((c) =>
            c.sourceUrl ? (
              // A website-sourced citation opens the real live page
              // directly, on click, in a new tab — there's no internal
              // preview to show for it (it was never rendered into a
              // PDF), so routing this through the same preview modal as
              // an uploaded file would just add an extra click to get to
              // the one thing worth showing.
              <a
                key={c.chunkId}
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${c.documentName} in a new tab`}
                className="flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {c.documentName}
                <ExternalLink size={10} className="shrink-0" />
              </a>
            ) : (
              <button
                key={c.chunkId}
                type="button"
                onClick={() => onCitationClick(c)}
                title={`Preview cited passage from ${c.documentName}`}
                className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {c.documentName}
              </button>
            ),
          )}
        </div>
      )}

      {!isStreaming && (
        <div
          className={`flex w-fit items-center gap-1 transition-opacity ${
            isLastAssistant ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md p-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="flex items-center gap-1 rounded-md p-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <RotateCw size={13} />
              Regenerate
            </button>
          )}
          {onFeedbackChange && (
            <>
              <button
                type="button"
                onClick={() => onFeedbackChange(message.feedback === 'UP' ? null : 'UP')}
                aria-label="Good response"
                aria-pressed={message.feedback === 'UP'}
                className={`flex items-center rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  message.feedback === 'UP' ? 'text-brand-600 dark:text-brand-400' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                <ThumbsUp size={13} fill={message.feedback === 'UP' ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => onFeedbackChange(message.feedback === 'DOWN' ? null : 'DOWN')}
                aria-label="Bad response"
                aria-pressed={message.feedback === 'DOWN'}
                className={`flex items-center rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  message.feedback === 'DOWN' ? 'text-red-600 dark:text-red-400' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                <ThumbsDown size={13} fill={message.feedback === 'DOWN' ? 'currentColor' : 'none'} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
      style={{ animationDelay: delay }}
    />
  );
}
