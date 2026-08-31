'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Copy, Check, RotateCw } from 'lucide-react';
import {
  sendMessage,
  regenerateMessage,
  createConversationAndSendMessage,
} from '@/app/(chat)/chat/actions';
import { Markdown } from '@/components/chat/Markdown';

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
}: {
  // null = the stateless "/chat" draft — no conversation exists yet.
  conversationId: string | null;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    setError(null);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'USER', content: question }]);

    startTransition(async () => {
      try {
        const result = conversationId
          ? await sendMessage(conversationId, question)
          : await createConversationAndSendMessage(question);

        setMessages((prev) => [
          ...prev,
          {
            id: result.messageId,
            role: 'ASSISTANT',
            content: result.text,
            citations: result.citations,
          },
        ]);

        if (!conversationId && 'conversationId' in result) {
          // This was the draft ("/chat") state — the conversation now
          // exists. Swap the URL to it (replace, not push, so the back
          // button doesn't land back on an empty draft). Also refresh: the
          // (chat) layout's Sidebar is a shared layout segment that stays
          // mounted across this client-side navigation, so without an
          // explicit refresh its server-rendered conversation list keeps
          // showing what it fetched on the *previous* page load and the
          // brand-new conversation is invisible in the sidebar until the
          // user manually reloads — confirmed via an actual first-message
          // send, not assumed. replace() changes the URL; refresh()
          // invalidates the Router cache so the layout's RSC segment
          // (including Sidebar) re-fetches.
          router.replace(`/chat/${result.conversationId}`);
          router.refresh();
        } else {
          // Existing conversation — re-fetches the (chat) layout's
          // server-rendered sidebar so it picks up recency reordering
          // (and, on an actual first message, the auto-generated title).
          // Cheap RSC refetch, not a full page reload; local `messages`
          // state above isn't touched by it.
          router.refresh();
        }
      } catch {
        setError('Something went wrong answering that. Please try again.');
      }
    });
  }

  function handleRegenerate(messageId: string) {
    // Only ever reachable from an existing assistant message's Regenerate
    // button, which can't render before a conversation (and conversationId)
    // exists — this guard is just for TypeScript's narrowing, not a real
    // runtime path.
    if (!conversationId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await regenerateMessage(conversationId, messageId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { id: result.messageId, role: 'ASSISTANT', content: result.text, citations: result.citations }
              : m,
          ),
        );
        router.refresh();
      } catch {
        setError('Could not regenerate that answer. Please try again.');
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
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
          {messages.map((m, i) => (
            <MessageBlock
              key={m.id}
              message={m}
              isLastAssistant={m.role === 'ASSISTANT' && i === messages.length - 1 && !pending}
              onRegenerate={
                m.role === 'ASSISTANT' && !m.id.startsWith('local-')
                  ? () => handleRegenerate(m.id)
                  : undefined
              }
            />
          ))}
          {pending && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="flex items-center gap-1">
                <Dot delay="0ms" />
                <Dot delay="150ms" />
                <Dot delay="300ms" />
              </div>
              Reading your authorized documents…
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-6">{inputBar}</div>
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

function MessageBlock({
  message,
  isLastAssistant,
  onRegenerate,
}: {
  message: ChatMessage;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
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
        <div className="max-w-[75%] rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-2">
      <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        <Markdown>{message.content}</Markdown>
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <span
              key={c.chunkId}
              title={c.documentName}
              className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
            >
              {c.documentName}
            </span>
          ))}
        </div>
      )}

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
    </div>
  );
}
