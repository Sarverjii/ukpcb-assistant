import { prisma } from '@/lib/db/prisma';
import type { DocumentStatus } from '@prisma/client';

export type CreateDocumentInput = {
  name: string;
  description?: string;
  fileKey: string;
  mimeType: string;
  fileSizeBytes: number;
  clearanceLevel: number;
  departmentIds?: string[];
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
      departments: input.departmentIds?.length ? { connect: input.departmentIds.map((id) => ({ id })) } : undefined,
      tags: input.tags ?? [],
      uploadedById: input.uploadedById,
      status: 'PENDING',
    },
  });
}

/**
 * Replaces a document's department tagging entirely (not merged) — paired
 * with updateChunksDepartmentsForDocument (lib/db/queries/chunks.ts) at
 * every call site, exactly mirroring how updateDocumentClearance is always
 * paired with updateChunksClearanceForDocument.
 */
export function updateDocumentDepartments(id: string, departmentIds: string[]) {
  return prisma.document.update({
    where: { id },
    data: { departments: { set: departmentIds.map((did) => ({ id: did })) } },
  });
}

export function getDocument(id: string) {
  return prisma.document.findUniqueOrThrow({ where: { id }, include: { departments: true } });
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
    include: { uploadedBy: { select: { name: true, email: true } }, departments: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Every document a specific employee uploaded, regardless of status —
 * backs the "Removed employees" review page (Feature 7), where an admin
 * decides, per document, whether to keep it (survives with uploadedById
 * set to null once the employee is hard-deleted) or delete it via the
 * existing deleteDocumentAction before that happens.
 */
export function listDocumentsByUploader(uploadedById: string) {
  return prisma.document.findMany({
    where: { uploadedById },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Read-only "browse what I'm cleared to see" list for the employee-facing
 * document library (Feature 2) — distinct from listDocumentsWithUploader
 * (management page: leaks uploader email, shows non-READY documents) and
 * listAccessibleDocumentSummaries (too narrow: no department/tags/dates,
 * built for the RAG document-inventory prompt, not a browsing UI).
 * Deliberately never takes an isAdmin bypass — every viewer, admin
 * included, sees only what their own clearanceRank/departments allow here.
 * `userDepartmentIds` extends visibility additively — a document is shown
 * if EITHER the clearance check passes OR the viewer shares a department
 * with the document, mirroring the SQL-level rule in
 * lib/db/queries/chunks.ts.
 */
export function listAccessibleDocumentSummariesForBrowsing(userClearanceRank: number, userDepartmentIds: string[]) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      OR: [
        { clearanceLevel: { lte: userClearanceRank } },
        { departments: { some: { id: { in: userDepartmentIds } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      departments: { select: { id: true, name: true } },
      tags: true,
      clearanceLevel: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
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
 * prompt the model actually sees. `userDepartmentIds` extends this the same
 * additive way as listAccessibleDocumentSummariesForBrowsing above.
 */
export function listAccessibleDocumentSummaries(userClearanceRank: number, userDepartmentIds: string[]) {
  return prisma.document.findMany({
    where: {
      status: 'READY',
      OR: [
        { clearanceLevel: { lte: userClearanceRank } },
        { departments: { some: { id: { in: userDepartmentIds } } } },
      ],
    },
    // id isn't sent to the LLM (see DocumentSummary in lib/llm/types.ts,
    // which only carries name/description) — it's used server-side by
    // lib/rag/documentNameMatch.ts to look up chunks when the question
    // names one of these documents directly.
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
}
