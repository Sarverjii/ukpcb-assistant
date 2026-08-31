'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Copy, Check, RotateCw, Download, ChevronDown, FileText, FileDown } from 'lucide-react';
import { streamChat } from '@/components/chat/streamChat';
import { Markdown } from '@/components/chat/Markdown';
import { CitationPreviewModal } from '@/components/chat/CitationPreviewModal';
import { downloadConversationMarkdown, exportConversationAsPdf } from '@/components/chat/exportConversation';

export type Citation = { documentId: string; documentName: string; chunkId: string };
export type ChatMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations?: Citation[];
};

export function ChatPanel({
  conversationId,
  initialMessages,
  initialTitle,
}: {
  // null = the stateless "/chat" draft — no conversation exists yet.
  conversationId: string | null;
  initialMessages: ChatMessage[];
  initialTitle: string | null;
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
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    startTransition(async () => {
      try {
        await streamChat({ conversationId, question }, (event) => {
          if (event.type === 'delta') {
            appendDelta(assistantMessageId, event.text);
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, id: event.messageId, citations: event.citations } : m,
              ),
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
      }
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  const inputBar = (
    <>
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
          placeholder="Ask anything about your authorized company knowledge…"
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
              onCitationClick={setPreviewCitation}
            />
          ))}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-6">{inputBar}</div>

      {previewCitation && (
        <CitationPreviewModal
          chunkId={previewCitation.chunkId}
          documentName={previewCitation.documentName}
          onClose={() => setPreviewCitation(null)}
        />
      )}
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
  onCitationClick,
}: {
  message: ChatMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onCitationClick: (citation: Citation) => void;
}) {
  const isUser = message.role === 'USER';
  const [copied, setCopied] = useState(false);

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
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">
          {message.content}
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
          {message.citations.map((c) => (
            <button
              key={c.chunkId}
              type="button"
              onClick={() => onCitationClick(c)}
              title={`Preview cited passage from ${c.documentName}`}
              className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {c.documentName}
            </button>
          ))}
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
