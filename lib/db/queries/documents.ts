import { prisma } from '@/lib/db/prisma';
import type { DocumentStatus } from '@prisma/client';

export type CreateDocumentInput = {
  name: string;
  description?: string;
  fileKey: string;
  mimeType: string;
  fileSizeBytes: number;
  clearanceLevel: number;
  department?: string;
  tags?: string[];
  uploadedById: string;
};

export function createDocument(input: CreateDocumentInput) {
  return prisma.document.create({
    data: {
      name: input.name,
      description: input.description,
      fileKey: input.fileKey,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      clearanceLevel: input.clearanceLevel,
      department: input.department,
      tags: input.tags ?? [],
      uploadedById: input.uploadedById,
      status: 'PENDING',
    },
  });
}

export function getDocument(id: string) {
  return prisma.document.findUniqueOrThrow({ where: { id } });
}

export function setDocumentStatus(id: string, status: DocumentStatus, processingError?: string) {
  return prisma.document.update({
    where: { id },
    data: { status, processingError: processingError ?? null },
  });
}

/**
 * Records (or clears) the storage key of the generated preview PDF — see
 * previewFileKey's doc comment in prisma/schema.prisma. Called once per
 * processing pass (lib/documents/pipeline.ts), always with the outcome of
 * THAT pass: null for a native PDF (nothing to generate) or a document
 * whose preview generation failed, a real key otherwise. Never left
 * pointing at a stale file from a previous pass.
 */
export function setDocumentPreviewFileKey(id: string, previewFileKey: string | null) {
  return prisma.document.update({ where: { id }, data: { previewFileKey } });
}

/**
 * `maxClearanceRank`, when given, restricts the list to documents at or
 * below that level — used for a non-admin knowledge-base manager, who
 * should never even see a document above their own clearance exists (let
 * alone manage it). Admins pass undefined and see everything, same as the
 * original admin Documents table always did.
 */
export function listDocumentsWithUploader(maxClearanceRank?: number) {
  return prisma.document.findMany({
    where: maxClearanceRank === undefined ? undefined : { clearanceLevel: { lte: maxClearanceRank } },
    include: { uploadedBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export function updateDocumentClearance(id: string, clearanceLevel: number) {
  return prisma.document.update({ where: { id }, data: { clearanceLevel } });
}

export function deleteDocument(id: string) {
  // Chunks cascade-delete via the FK (onDelete: Cascade in schema.prisma).
  return prisma.document.delete({ where: { id } });
}

/** Swaps in a new file for an existing document, resetting it for reprocessing. */
export function updateDocumentFile(
  id: string,
  file: { fileKey: string; mimeType: string; fileSizeBytes: number },
) {
  return prisma.document.update({
    where: { id },
    data: { ...file, status: 'PENDING', processingError: null },
  });
}

/**
 * Document *metadata* (names/descriptions), filtered the same way as
 * retrieveAuthorizedChunks() — clearanceLevel <= the caller's rank, in the
 * query itself. This is what answers "how many documents do you have" /
 * "what documents exist" style questions: that information was never in any
 * chunk's CONTENT (no document says "there are N documents"), so semantic
 * retrieval correctly finds nothing for it regardless of clearance — this
 * is a different data source (document inventory, not document content),
 * not a relaxation of the content-retrieval boundary. See
 * lib/rag/chat.ts::answerQuestion for how the two are kept separate in the
 * prompt the model actually sees.
 */
export function listAccessibleDocumentSummaries(userClearanceRank: number) {
  return prisma.document.findMany({
    where: { clearanceLevel: { lte: userClearanceRank }, status: 'READY' },
    // id isn't sent to the LLM (see DocumentSummary in lib/llm/types.ts,
    // which only carries name/description) — it's used server-side by
    // lib/rag/documentNameMatch.ts to look up chunks when the question
    // names one of these documents directly.
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
}
