'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUp, ExternalLink, LogIn } from 'lucide-react';
import { streamPublicChat } from '@/components/chat/streamPublicChat';
import { Markdown } from '@/components/chat/Markdown';
import type { Citation } from '@/components/chat/ChatPanel';
import type { ChatTurn } from '@/lib/llm/types';

type PublicMessage = { id: string; role: 'USER' | 'ASSISTANT'; content: string; citations?: Citation[] };

/**
 * The unauthenticated home-page chat — a deliberately standalone, much
 * simpler sibling of ChatPanel.tsx, not a reuse of it: there is no
 * conversation to persist, no sidebar, no regenerate/edit/feedback, no
 * document-scope picker, and no citation-preview modal (that modal's
 * content fetch — getCitationPreviewAction — requires a real session).
 * Everything lives in plain component state for the lifetime of this page
 * load; a refresh starts a fresh chat, by design (see
 * app/api/public-chat/stream/route.ts's own comment for why nothing is
 * persisted server-side either). Only ever backed by Admin → Public
 * Content's own curated document/URL pool — see
 * lib/db/queries/chunks.ts::retrievePublicChunks.
 */
export function PublicChatPanel() {
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const idCounter = useRef(0);
  function nextId(prefix: string): string {
    idCounter.current += 1;
    return `${prefix}-${idCounter.current}`;
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function appendDelta(messageId: string, text: string) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: m.content + text } : m)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    setError(null);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // History as it stood BEFORE this question — this exact array is what
    // gets sent to the server (see below), matching the employee chat's
    // own "history is everything before the turn now being answered"
    // contract.
    const historyForThisTurn: ChatTurn[] = messages.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    const assistantMessageId = nextId('assistant');
    setMessages((prev) => [
      ...prev,
      { id: nextId('user'), role: 'USER', content: question },
      { id: assistantMessageId, role: 'ASSISTANT', content: '' },
    ]);
    setStreamingId(assistantMessageId);

    startTransition(async () => {
      try {
        await streamPublicChat({ question, history: historyForThisTurn }, (event) => {
          if (event.type === 'delta') {
            appendDelta(assistantMessageId, event.text);
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessageId ? { ...m, citations: event.citations } : m)),
            );
          } else if (event.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: `${m.content}${m.content ? '\n\n' : ''}⚠️ ${event.message}` }
                  : m,
              ),
            );
          }
        });
      } catch {
        setError('Something went wrong answering that. Please try again.');
      } finally {
        setStreamingId(null);
        textareaRef.current?.focus();
      }
    });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  // A real app header — logo, wordmark, and a solid primary CTA — not a
  // bare bordered pill floating in empty space (the earlier design: same
  // small outline style DepartmentPicker/filter dropdowns use for a
  // secondary, low-emphasis action, which read as an afterthought for the
  // one action every visitor on this page might actually want). Mirrors
  // the login page's own logo treatment and the app's established primary-
  // button style (e.g. "Create employee", "Add page" — bg-brand-700,
  // rounded-lg, white text) so this reads as the same professional product
  // as the authenticated app, not a stripped-down public afterthought.
  const header = (
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Uttarakhand Pollution Control Board" className="h-8 w-auto shrink-0" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">UKPCB Assistant</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Public</p>
        </div>
      </div>
      <Link
        href="/login"
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-700 dark:bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-800 dark:hover:bg-brand-500"
      >
        <LogIn size={15} />
        <span className="hidden sm:inline">Employee Login</span>
        <span className="sm:hidden">Login</span>
      </Link>
    </header>
  );

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
          placeholder="Ask a question about the Board…"
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
        Answers only from public UKPCB information. A Board employee?{' '}
        <Link href="/login" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
          Log in
        </Link>{' '}
        for the full assistant.
      </p>
    </>
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">UKPCB Public Assistant</h1>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">
              Ask about the Uttarakhand Pollution Control Board — no login required.
            </p>
          </div>
          <div className="w-full max-w-3xl">{inputBar}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
          {messages.map((m) => (
            <PublicMessageBlock key={m.id} message={m} isStreaming={m.id === streamingId} />
          ))}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-6">{inputBar}</div>
    </div>
  );
}

function PublicMessageBlock({ message, isStreaming }: { message: PublicMessage; isStreaming: boolean }) {
  if (message.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  if (isStreaming && message.content.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <div className="flex items-center gap-1">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </div>
        Reading public documents…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        <Markdown>{message.content}</Markdown>
        {isStreaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-zinc-400 dark:bg-zinc-500 align-middle" />
        )}
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <a
              key={c.chunkId}
              // A public URL-sourced citation opens the real live page
              // directly (nothing to preview — see the employee chat's
              // matching comment); an uploaded public document opens the
              // unauthenticated public view route instead of the
              // employee-only citation-preview modal (which needs a real
              // session to fetch its content).
              href={c.sourceUrl ?? `/api/public-documents/${c.documentId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${c.documentName}`}
              className="flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {c.documentName}
              <ExternalLink size={10} className="shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: delay }} />;
}
