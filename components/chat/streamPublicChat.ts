import type { Citation } from '@/components/chat/ChatPanel';
import type { ChatTurn } from '@/lib/llm/types';

export type PublicStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; citations: Citation[] }
  | { type: 'error'; message: string };

/**
 * Public counterpart of components/chat/streamChat.ts — same NDJSON
 * reading loop, against /api/public-chat/stream instead. No
 * conversationId/regenerate/edit modes: the public chat has none of those,
 * and sends its whole `history` back on every turn since nothing is
 * persisted server-side (see that route's own comment).
 */
export async function streamPublicChat(
  body: { question: string; history: ChatTurn[] },
  onEvent: (event: PublicStreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/public-chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: data.error ?? 'Something went wrong answering that.' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        onEvent(JSON.parse(line) as PublicStreamEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
