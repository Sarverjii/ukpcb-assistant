'use server';

import { getAuthContext } from '@/lib/auth/session';
import {
  createConversation,
  getConversationForUser,
  appendMessage,
  touchConversation,
  deleteMessage,
  deleteConversation,
} from '@/lib/db/queries/conversations';
import { prisma } from '@/lib/db/prisma';
import { answerQuestion } from '@/lib/rag/chat';
import type { ChatTurn } from '@/lib/llm/types';

export type DeleteConversationResult = { error?: string };

/**
 * Deletes a conversation and its messages (cascade). Ownership is enforced
 * inside deleteConversation() itself (scoped WHERE, not fetch-then-check),
 * so calling this with someone else's conversation ID just no-ops rather
 * than deleting the wrong thing or throwing a revealing error.
 */
export async function deleteConversationAction(conversationId: string): Promise<DeleteConversationResult> {
  const ctx = await getAuthContext();
  const deleted = await deleteConversation(conversationId, ctx.userId);
  if (!deleted) {
    return { error: 'Conversation not found.' };
  }
  return {};
}

function autoTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

export async function sendMessage(conversationId: string, question: string) {
  const ctx = await getAuthContext();

  // Ownership check happens inside the query itself (WHERE userId = ...),
  // not by fetching-then-checking — same principle as chunk retrieval.
  const conversation = await getConversationForUser(conversationId, ctx.userId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const history: ChatTurn[] = conversation.messages.map((m) => ({
    role: m.role === 'USER' ? 'user' : 'assistant',
    content: m.content,
  }));

  await appendMessage(conversationId, 'USER', question);
  if (!conversation.title && conversation.messages.length === 0) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { title: autoTitle(question) },
    });
  }

  const result = await answerQuestion(ctx, conversationId, question, history);

  const assistantMessage = await appendMessage(conversationId, 'ASSISTANT', result.text, result.citations);
  await touchConversation(conversationId);

  return { ...result, messageId: assistantMessage.id };
}

/**
 * Used for the very first message of a brand-new chat: "/chat" (and "/",
 * which redirects there) never eagerly creates a conversation row just from
 * being opened — visiting it always shows a genuinely blank composer, not
 * whatever you were last talking about, and doesn't clutter the sidebar
 * with an empty entry every time you open the app. The conversation only
 * starts existing once there's an actual first message, at which point this
 * creates it and immediately reuses sendMessage() for the rest of the logic
 * (title, retrieval, answer) so there's exactly one place that does that.
 */
export async function createConversationAndSendMessage(question: string) {
  const ctx = await getAuthContext();
  const conversation = await createConversation(ctx.userId);
  const result = await sendMessage(conversation.id, question);
  return { ...result, conversationId: conversation.id };
}

/**
 * Regenerates one assistant answer in place: the old assistant message is
 * deleted and a fresh one is generated from the same question and the
 * conversation history up to (not including) that pair — same authorization
 * path as a normal send, just re-run.
 */
export async function regenerateMessage(conversationId: string, assistantMessageId: string) {
  const ctx = await getAuthContext();

  const conversation = await getConversationForUser(conversationId, ctx.userId);
  if (!conversation) throw new Error('Conversation not found.');

  const targetIndex = conversation.messages.findIndex((m) => m.id === assistantMessageId);
  if (targetIndex < 1 || conversation.messages[targetIndex].role !== 'ASSISTANT') {
    throw new Error('Message not found.');
  }

  const question = conversation.messages[targetIndex - 1].content;
  const history: ChatTurn[] = conversation.messages.slice(0, targetIndex - 1).map((m) => ({
    role: m.role === 'USER' ? 'user' : 'assistant',
    content: m.content,
  }));

  await deleteMessage(assistantMessageId);
  const result = await answerQuestion(ctx, conversationId, question, history);
  const newMessage = await appendMessage(conversationId, 'ASSISTANT', result.text, result.citations);
  await touchConversation(conversationId);

  return { ...result, messageId: newMessage.id };
}
