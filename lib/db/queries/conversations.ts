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
