'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LAST_CONVERSATION_STORAGE_KEY } from '@/lib/lastConversation';

// No real subscription needed — this store never changes without a full
// navigation (which remounts the page tree anyway), so the "subscribe"
// half of useSyncExternalStore is a no-op. What's actually needed is its
// other half: getServerSnapshot, returning a stable "/chat" during SSR
// (where localStorage doesn't exist) so the client's first render matches
// exactly, then getSnapshot supplies the real value right after — the
// React-documented way to read a client-only store without a hydration
// mismatch, rather than a useEffect+setState that would flag as "you
// might not need an effect" (there's nothing to synchronize an effect
// against here; this is a plain external-store read).
function subscribe() {
  return () => {};
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(LAST_CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

/**
 * "Back to chat" used to always land on the blank draft ("/chat"), even
 * when you'd navigated here from a real conversation — reading a settings
 * page and then wanting to pick the conversation back up meant losing your
 * place. Points at the last conversation actually viewed (see
 * ChatPanel.tsx, which records it) when there is one, else falls back to
 * the plain draft exactly like before this existed.
 */
export function BackToChatLink() {
  const lastConversationId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const href = lastConversationId ? `/chat/${lastConversationId}` : '/chat';

  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-brand-600"
    >
      <ArrowLeft size={16} />
      Back to chat
    </Link>
  );
}
