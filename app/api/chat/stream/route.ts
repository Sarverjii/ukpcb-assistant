import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import {
  createConversation,
  getConversationForUser,
  appendMessage,
  touchConversation,
  deleteMessage,
} from '@/lib/db/queries/conversations';
import { prisma } from '@/lib/db/prisma';
import { streamAnswer } from '@/lib/rag/chat';
import type { ChatTurn } from '@/lib/llm/types';

// Same reasoning as the other slow/model-bound routes in this app (see
// app/(app)/admin/documents/page.tsx's matching comment) — a streamed
// answer can still take a while to finish even though the first token now
// arrives almost immediately.
export const maxDuration = 60;

function autoTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

type StreamRequestBody = {
  conversationId: string | null;
  question?: string;
  regenerateMessageId?: string;
};

/**
 * Streams one chat answer as newline-delimited JSON — plain fetch +
 * ReadableStream rather than a Server Action, because a Server Action's
 * return value is a single serialized result, not a token stream. Each
 * line is one of:
 *   {"type":"delta","text":"..."}                      — an answer token
 *   {"type":"done","messageId","conversationId","citations","isNewConversation"}
 *   {"type":"error","message":"..."}
 * The client (ChatPanel.tsx) reads the body with a plain reader and
 * appends "delta" text to the message it's rendering as it arrives.
 *
 * Handles both "send a new message" (question set) and "regenerate an
 * existing answer" (regenerateMessageId set) — mirrors sendMessage() /
 * regenerateMessage() in ./chat/actions.ts, which remain in place
 * unstreamed for tests/authz.test.ts and any future non-streaming caller,
 * but are no longer used by the chat UI itself now that this route covers
 * both paths with streaming.
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    throw err;
  }

  const body = (await request.json().catch(() => null)) as StreamRequestBody | null;
  if (!body || (!body.question && !body.regenerateMessageId)) {
    return NextResponse.json({ error: 'question or regenerateMessageId is required.' }, { status: 400 });
  }

  let conversationId = body.conversationId;
  let isNewConversation = false;
  let question: string;
  let history: ChatTurn[];

  if (body.regenerateMessageId) {
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required to regenerate.' }, { status: 400 });
    }
    const conversation = await getConversationForUser(conversationId, ctx.userId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }
    const targetIndex = conversation.messages.findIndex((m) => m.id === body.regenerateMessageId);
    if (targetIndex < 1 || conversation.messages[targetIndex].role !== 'ASSISTANT') {
      return NextResponse.json({ error: 'Message not found.' }, { status: 404 });
    }
    question = conversation.messages[targetIndex - 1].content;
    history = conversation.messages.slice(0, targetIndex - 1).map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));
    await deleteMessage(body.regenerateMessageId);
  } else {
    question = body.question!;
    if (!conversationId) {
      const conversation = await createConversation(ctx.userId);
      conversationId = conversation.id;
      isNewConversation = true;
      history = [];
    } else {
      const conversation = await getConversationForUser(conversationId, ctx.userId);
      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
      }
      history = conversation.messages.map((m) => ({
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.content,
      }));
    }
    await appendMessage(conversationId, 'USER', question);
    if (isNewConversation) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { title: autoTitle(question) },
      });
    }
  }

  const finalConversationId = conversationId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: unknown) {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      }

      try {
        const gen = streamAnswer(ctx, finalConversationId, question, history);
        let next = await gen.next();
        while (!next.done) {
          send({ type: 'delta', text: next.value });
          next = await gen.next();
        }
        const { text, citations } = next.value;

        const assistantMessage = await appendMessage(finalConversationId, 'ASSISTANT', text, citations);
        await touchConversation(finalConversationId);

        send({
          type: 'done',
          messageId: assistantMessage.id,
          conversationId: finalConversationId,
          citations,
          isNewConversation,
        });
      } catch (err) {
        // Whatever text already streamed to the client stays visible (see
        // geminiProvider.ts's matching comment) — this just tells the UI
        // generation was cut short, without discarding the partial answer.
        // Deliberately not persisted to the DB: an incomplete answer isn't
        // something a later "regenerate" should be regenerating from.
        console.error('[chat stream] failed mid-stream', err);
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
