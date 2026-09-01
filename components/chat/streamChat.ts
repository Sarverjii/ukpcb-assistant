import type { Citation } from '@/components/chat/ChatPanel';

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; conversationId: string; citations: Citation[]; isNewConversation: boolean }
  | { type: 'error'; message: string };

/**
 * Reads app/api/chat/stream/route.ts's newline-delimited JSON response and
 * invokes onEvent for each line as it arrives. A plain fetch + manual
 * reader rather than EventSource/SSE: EventSource can't send a POST body
 * (the question, conversationId, etc. all need to go up), and NDJSON over
 * a normal streamed Response needs no extra client library.
 */
export async function streamChat(
  body: {
    conversationId: string | null;
    question?: string;
    regenerateMessageId?: string;
    editMessageId?: string;
    content?: string;
    scopedDocumentIds?: string[];
  },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/chat/stream', {
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
        onEvent(JSON.parse(line) as StreamEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
