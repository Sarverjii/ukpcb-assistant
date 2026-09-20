import { streamPublicAnswer } from '@/lib/rag/publicChat';
import { checkAndConsumePublicUsage, UsageLimitExceededError } from '@/lib/usage/limits';
import { clientIp } from '@/lib/http/clientIp';
import type { ChatTurn } from '@/lib/llm/types';

// Same reasoning as the employee chat's matching maxDuration — a streamed
// answer can still take a while to finish even though the first token
// arrives almost immediately.
export const maxDuration = 60;

// Same NDJSON contract as app/api/chat/stream/route.ts (see that route's
// own comment for exactly why a plain JSON error body isn't safe to use
// instead) — this route intentionally mirrors it line-for-line except
// where noted, so the same real bug it documents can't quietly resurface
// here.
function errorStreamResponse(message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}

type PublicStreamRequestBody = {
  question: string;
  // The whole conversation so far, sent back by the client every turn —
  // nothing is persisted server-side for the public chat (no Conversation/
  // Message rows: there is no real account to attach them to, and this
  // surface is reachable by literally anyone on the internet, not just
  // this app's own employees). Each line is one of:
  //   {"type":"delta","text":"..."}   — an answer token
  //   {"type":"done","citations"}
  //   {"type":"error","message":"..."}
  history?: ChatTurn[];
};

/**
 * Streams one public-chat answer — the unauthenticated counterpart of
 * app/api/chat/stream/route.ts. No getAuthContext call anywhere in this
 * route: there is no session to check. Authorization instead comes
 * entirely from what streamPublicAnswer() is even able to retrieve (see
 * lib/db/queries/chunks.ts::retrievePublicChunks — ONLY isPublic content,
 * unconditionally), and abuse protection comes from
 * checkAndConsumePublicUsage (a completely separate quota pool from
 * employee usage — see that function's own comment), checked and consumed
 * before any retrieval or LLM call, same "a blocked request costs
 * nothing" discipline the employee path already has.
 */
export async function POST(request: Request) {
  const ip = clientIp(request) ?? 'unknown';

  try {
    await checkAndConsumePublicUsage(ip);
  } catch (err) {
    if (err instanceof UsageLimitExceededError) {
      return errorStreamResponse(err.message);
    }
    throw err;
  }

  const body = (await request.json().catch(() => null)) as PublicStreamRequestBody | null;
  const question = body?.question?.trim();
  if (!question) {
    return Response.json({ error: 'question is required.' }, { status: 400 });
  }
  const history = body?.history ?? [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: unknown) {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      }

      try {
        const gen = streamPublicAnswer(question, history, ip);
        let next = await gen.next();
        while (!next.done) {
          send({ type: 'delta', text: next.value });
          next = await gen.next();
        }
        const { citations } = next.value;
        send({ type: 'done', citations });
      } catch (err) {
        console.error('[public chat stream] failed mid-stream', err);
        send({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
