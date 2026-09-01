import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

export function createConversation(userId: string, title?: string) {
  return prisma.conversation.create({ data: { userId, title } });
}

// Ownership is enforced by scoping the query itself (userId in WHERE), not
// by fetching the conversation and checking it in application code — the
// same "don't fetch what you shouldn't see" principle as chunk retrieval.
export function getConversationForUser(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export function listConversationsForUser(userId: string) {
  return prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
}

export type ConversationSearchMatch = { conversationId: string; snippet: string };

/**
 * Full-text-by-substring search across a user's OWN message content —
 * Sidebar's existing search box only ever filtered the already-fetched
 * conversation list client-side by TITLE (conversations have no content in
 * that prop), so this is a genuinely new server round trip, not a filter
 * tweak. Scoped to the caller's own conversations in the WHERE, same
 * ownership-scoping principle as everywhere else. A plain ILIKE scan is
 * fine at this app's stated scale (Sidebar's own comment: "dozens, not
 * thousands" of conversations per user) — a GIN/trigram index is a
 * deliberately-not-built future refinement if that ever changes.
 * DISTINCT ON keeps one (the most recent) match per conversation, so a
 * conversation with many matching messages still surfaces once.
 */
export async function searchConversationsByContent(
  userId: string,
  query: string,
): Promise<ConversationSearchMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const like = `%${trimmed}%`;
  return prisma.$queryRaw<ConversationSearchMatch[]>`
    SELECT DISTINCT ON (m."conversationId") m."conversationId" AS "conversationId",
      substring(m.content from greatest(1, position(lower(${trimmed}) in lower(m.content)) - 40) for 140) AS snippet
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."userId" = ${userId} AND m.content ILIKE ${like}
    ORDER BY m."conversationId", m."createdAt" DESC
  `;
}

/** Used only to report how many conversations are about to cascade-delete
 * with an employee being hard-deleted (see deleteEmployeePermanentlyAction)
 * — captured into that action's audit-log entry before the delete runs. */
export function countConversationsForUser(userId: string) {
  return prisma.conversation.count({ where: { userId } });
}

export function appendMessage(
  conversationId: string,
  role: 'USER' | 'ASSISTANT',
  content: string,
  citations?: Prisma.InputJsonValue,
) {
  return prisma.message.create({
    data: { conversationId, role, content, citations },
  });
}

/**
 * Ownership-scoped rename, same "scope the query, don't fetch-then-check"
 * principle as deleteConversation below — a conversation id belonging to
 * another user matches zero rows instead of renaming the wrong thing.
 */
export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { title },
  });
  return count > 0;
}

export function touchConversation(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

export function deleteMessage(messageId: string) {
  return prisma.message.delete({ where: { id: messageId } });
}

/**
 * Backs "edit a sent message": ownership-scoped in the WHERE (role: 'USER'
 * too — an ASSISTANT message is never editable), same pattern as
 * renameConversation. Only touches content/editedAt; the caller is
 * responsible for deleting everything after this message separately (see
 * deleteMessagesByIds) and for regenerating a fresh reply.
 */
export async function updateMessageContent(messageId: string, userId: string, content: string): Promise<boolean> {
  const { count } = await prisma.message.updateMany({
    where: { id: messageId, role: 'USER', conversation: { userId } },
    data: { content, editedAt: new Date() },
  });
  return count > 0;
}

/**
 * Deletes an exact, already-known set of message ids — used to wipe
 * everything after an edited message. Deliberately id-list-based rather
 * than a `createdAt >` comparison: Message has no secondary sort key, and
 * the caller always already has the ordered messages array (from
 * getConversationForUser) to slice ids out of, so there's no same-
 * millisecond edge case to worry about. No ownership check here — the
 * caller (the edit route/action) already established ownership via
 * getConversationForUser before computing which ids to pass.
 */
export function deleteMessagesByIds(messageIds: string[]) {
  if (messageIds.length === 0) return Promise.resolve({ count: 0 });
  return prisma.message.deleteMany({ where: { id: { in: messageIds } } });
}

/**
 * Ownership-scoped delete: `deleteMany` with `userId` in the WHERE means a
 * conversation ID belonging to another user matches zero rows rather than
 * throwing or deleting — same "scope the query, don't fetch-then-check"
 * principle as everywhere else. Messages cascade via the FK
 * (onDelete: Cascade in schema.prisma).
 */
export async function deleteConversation(conversationId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.conversation.deleteMany({
    where: { id: conversationId, userId },
  });
  return count > 0;
}
