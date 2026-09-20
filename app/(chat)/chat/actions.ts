'use server';

import { getAuthContext } from '@/lib/auth/session';
import {
  createConversation,
  getConversationForUser,
  appendMessage,
  touchConversation,
  deleteMessage,
  deleteConversation,
  renameConversation,
  updateMessageContent,
  deleteMessagesByIds,
  searchConversationsByContent,
} from '@/lib/db/queries/conversations';
import { getChunkForUser } from '@/lib/db/queries/chunks';
import { logAuditEvent } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { answerQuestion } from '@/lib/rag/chat';
import { checkAndConsumeUsage } from '@/lib/usage/limits';
import type { ChatTurn } from '@/lib/llm/types';

export type DeleteConversationResult = { error?: string };

export type RenameConversationResult = { error?: string };

const MAX_TITLE_LENGTH = 80;

export async function renameConversationAction(
  conversationId: string,
  title: string,
): Promise<RenameConversationResult> {
  const ctx = await getAuthContext();
  const trimmed = title.trim();
  if (!trimmed) return { error: 'Title cannot be empty.' };

  const renamed = await renameConversation(conversationId, ctx.userId, trimmed.slice(0, MAX_TITLE_LENGTH));
  if (!renamed) return { error: 'Conversation not found.' };
  return {};
}

/**
 * Content search across the caller's own conversations — Sidebar's
 * existing filter only ever matched titles (nothing else in the prop it
 * receives has message content), so this is a genuine new round trip, not
 * a client-side filter tweak. Called debounced from the Sidebar as the
 * user types; ownership is scoped inside searchConversationsByContent's
 * own WHERE.
 */
export async function searchConversationsAction(query: string) {
  const ctx = await getAuthContext();
  return searchConversationsByContent(ctx.userId, query);
}

export type CitationPreviewResult =
  | {
      content: string;
      documentId: string;
      documentName: string;
      // 1-based real page/slide, or synthetic per-chunk page into a
      // generated preview PDF — see ChunkForUser's doc comment. Null only
      // for a chunk that predates page tracking entirely.
      pageNumber: number | null;
      // True whenever there's an actual PDF to render inline — the
      // original (already a PDF) or a generated preview rendition for
      // any other supported format. False only for a chunk that predates
      // page tracking, or one whose preview generation failed — those
      // still fall back to the plain text passage.
      previewable: boolean;
      // Which word the preview UI should use for pageNumber — a PPTX's
      // native pagination is genuinely slides; every other format (PDF,
      // and DOCX/TXT/MD's generated preview) reads as pages.
      unit: 'page' | 'slide';
      // Set only for a document added by pasting a URL — see
      // ChunkForUser's own comment.
      sourceUrl: string | null;
    }
  | { error: string };

/**
 * Backs the citation-preview modal: re-derives clearance fresh from the DB
 * (getAuthContext) and re-checks it against the chunk's own clearanceRank
 * (getChunkForUser) before returning any content — the same "authorize at
 * read time, not just at answer time" rule as everywhere else, since a
 * chunk id that was authorized when the answer was generated isn't proof
 * it's still authorized now (a role/clearance change in between would
 * otherwise leak through this second read path). The actual PDF bytes for
 * the inline preview are served separately by
 * app/api/documents/[id]/view/route.ts, which re-does this exact same
 * check independently — this action never hands back a URL that
 * side-steps it.
 */
export async function getCitationPreviewAction(chunkId: string): Promise<CitationPreviewResult> {
  const ctx = await getAuthContext();
  const chunk = await getChunkForUser(
    chunkId,
    ctx.clearanceRank,
    ctx.departmentIds,
    ctx.hasHeadDepartmentAccess,
    ctx.locationId,
  );
  if (!chunk) return { error: 'This citation is no longer available to your role.' };

  await logAuditEvent({
    action: 'CITATION_PREVIEWED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: chunk.documentId,
    metadata: { documentName: chunk.documentName },
  });

  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return {
    content: chunk.content,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    pageNumber: chunk.pageNumber,
    previewable: chunk.mimeType === 'application/pdf' || chunk.previewFileKey != null,
    unit: chunk.mimeType === PPTX_MIME ? 'slide' : 'page',
    sourceUrl: chunk.sourceUrl,
  };
}

/**
 * Deletes a conversation and its messages (cascade). Ownership is enforced
 * both by getConversationForUser's own scoped WHERE (fetched first, purely
 * to capture the title before it's gone — the row won't exist to look up
 * afterward) and again by deleteConversation's own scoped WHERE, so
 * calling this with someone else's conversation ID just 404s rather than
 * deleting the wrong thing or throwing a revealing error.
 */
export async function deleteConversationAction(conversationId: string): Promise<DeleteConversationResult> {
  const ctx = await getAuthContext();
  const conversation = await getConversationForUser(conversationId, ctx.userId);
  if (!conversation) {
    return { error: 'Conversation not found.' };
  }

  await deleteConversation(conversationId, ctx.userId);
  await logAuditEvent({
    action: 'CONVERSATION_DELETED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: conversationId,
    // The conversation row is gone after this — its title/message count
    // only survive if captured here, in the log entry itself. Same
    // "capture everything needed at write time" discipline as every other
    // delete action in this app (see e.g. deleteDocumentAction).
    metadata: { conversationTitle: conversation.title, messageCount: conversation.messages.length },
  });
  return {};
}

export type SetMessageFeedbackResult = { error?: string };

/**
 * Toggleable thumbs up/down on one assistant message. A single scoped
 * updateMany, same "scope the query in its own WHERE, don't fetch-then-
 * check" ownership principle as deleteConversation above — id, ASSISTANT-
 * only, and conversation.userId all live in the WHERE, so a message
 * belonging to someone else's conversation just matches zero rows rather
 * than being fetched and rejected. The client always passes the target
 * value explicitly (it already knows the message's current feedback from
 * its own state), so this stays a blind write — no read-before-write
 * round trip, and toggle-vs-set is a client-side decision, not a server
 * concern. Not audited: a freely-reversible UI preference, not a
 * security-relevant action — consistent with Copy/Regenerate clicks also
 * going unaudited.
 */
export async function setMessageFeedbackAction(
  messageId: string,
  feedback: 'UP' | 'DOWN' | null,
): Promise<SetMessageFeedbackResult> {
  const ctx = await getAuthContext();
  const { count } = await prisma.message.updateMany({
    where: { id: messageId, role: 'ASSISTANT', conversation: { userId: ctx.userId } },
    data: { feedback },
  });
  if (count === 0) return { error: 'Message not found.' };
  return {};
}

function autoTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}

export async function sendMessage(conversationId: string, question: string) {
  const ctx = await getAuthContext();
  // Checked and CONSUMED before anything else — see
  // lib/usage/limits.ts's module comment. Throws UsageLimitExceededError
  // (a plain Error subclass) straight through to the caller, same as
  // every other failure in this non-streaming path.
  await checkAndConsumeUsage({ userId: ctx.userId, departmentIds: ctx.departmentIds });

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
  await checkAndConsumeUsage({ userId: ctx.userId, departmentIds: ctx.departmentIds });

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

/**
 * Non-streaming counterpart of the stream route's editMessageId mode — kept
 * in sync for tests/authz.test.ts and any future non-streaming caller, same
 * as regenerateMessage above; the live chat UI uses the streaming route
 * exclusively. Wipes every message after the edited one and regenerates
 * from a history that stops at the edit point, per the exact same contract
 * documented on the route.
 */
export async function editMessage(conversationId: string, messageId: string, newContent: string) {
  const ctx = await getAuthContext();
  await checkAndConsumeUsage({ userId: ctx.userId, departmentIds: ctx.departmentIds });

  const conversation = await getConversationForUser(conversationId, ctx.userId);
  if (!conversation) throw new Error('Conversation not found.');

  const targetIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (targetIndex < 0 || conversation.messages[targetIndex].role !== 'USER') {
    throw new Error('Message not found.');
  }

  const trimmed = newContent.trim();
  const history: ChatTurn[] = conversation.messages.slice(0, targetIndex).map((m) => ({
    role: m.role === 'USER' ? 'user' : 'assistant',
    content: m.content,
  }));

  await updateMessageContent(messageId, ctx.userId, trimmed);
  const idsToDelete = conversation.messages.slice(targetIndex + 1).map((m) => m.id);
  await deleteMessagesByIds(idsToDelete);

  const result = await answerQuestion(ctx, conversationId, trimmed, history);
  const newMessage = await appendMessage(conversationId, 'ASSISTANT', result.text, result.citations);
  await touchConversation(conversationId);

  return { ...result, messageId: newMessage.id };
}
