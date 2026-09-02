import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import {
  createConversation,
  getConversationForUser,
  appendMessage,
  touchConversation,
  deleteMessage,
  updateMessageContent,
  deleteMessagesByIds,
} from '@/lib/db/queries/conversations';
import { prisma } from '@/lib/db/prisma';
import { streamAnswer } from '@/lib/rag/chat';
import type { ChatTurn } from '@/lib/llm/types';

// Same reasoning as the other slow/model-bound routes in this app (see
// app/(app)/knowledge-base/page.tsx's matching comment) — a streamed
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
  // Edit-a-sent-message mode: editMessageId is the USER message being
  // edited, content is its new text. Mutually exclusive with question and
  // regenerateMessageId.
  editMessageId?: string;
  content?: string;
  // Scope this question to specific document(s) instead of corpus-wide
  // retrieval — see lib/rag/chat.ts::retrieveContext. Not carried over on
  // regenerate (see that branch below) — a deliberate v1 limitation, not a
  // bug: regenerate has no fresh client input today for anything beyond
  // the message id.
  scopedDocumentIds?: string[];
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
 * Handles three modes: "send a new message" (question set), "regenerate an
 * existing answer" (regenerateMessageId set), and "edit a sent message"
 * (editMessageId + content set — deletes everything after it and
 * regenerates from a history that stops at the edit point). Mirrors
 * sendMessage() / regenerateMessage() in ./chat/actions.ts, which remain in
 * place unstreamed for tests/authz.test.ts and any future non-streaming
 * caller, but are no longer used by the chat UI itself now that this route
 * covers every path with streaming.
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
  if (!body || (!body.question && !body.regenerateMessageId && !body.editMessageId)) {
    return NextResponse.json({ error: 'question, regenerateMessageId, or editMessageId is required.' }, { status: 400 });
  }

  let conversationId = body.conversationId;
  let isNewConversation = false;
  let question: string;
  let history: ChatTurn[];
  // Only set on a fresh send (a brand-new USER row is created) — regenerate
  // and edit both reuse an already-known, already-real message id on the
  // client, so there's nothing new for the client to reconcile there.
  let newUserMessageId: string | undefined;

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
  } else if (body.editMessageId) {
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required to edit.' }, { status: 400 });
    }
    const newContent = body.content?.trim();
    if (!newContent) {
      return NextResponse.json({ error: 'content is required to edit.' }, { status: 400 });
    }
    const conversation = await getConversationForUser(conversationId, ctx.userId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    }
    const targetIndex = conversation.messages.findIndex((m) => m.id === body.editMessageId);
    if (targetIndex < 0 || conversation.messages[targetIndex].role !== 'USER') {
      return NextResponse.json({ error: 'Message not found.' }, { status: 404 });
    }
    // History is everything strictly BEFORE the edited message — the
    // edited message itself is passed as `question` below, so together
    // they're exactly "the conversation up through the edit point", per
    // spec: editing message N wipes everything after it and the model
    // sees only messages 1..N for its regenerated reply.
    question = newContent;
    history = conversation.messages.slice(0, targetIndex).map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));
    await updateMessageContent(body.editMessageId, ctx.userId, newContent);
    const idsToDelete = conversation.messages.slice(targetIndex + 1).map((m) => m.id);
    await deleteMessagesByIds(idsToDelete);
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
    const newUserMessage = await appendMessage(conversationId, 'USER', question);
    newUserMessageId = newUserMessage.id;
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
        // Not carried over on regenerate — see StreamRequestBody's comment.
        const scopedDocumentIds = body.regenerateMessageId ? undefined : body.scopedDocumentIds;
        const gen = streamAnswer(ctx, finalConversationId, question, history, scopedDocumentIds);
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
          userMessageId: newUserMessageId,
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
