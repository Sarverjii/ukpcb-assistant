import { prisma } from '@/lib/db/prisma';
import { toSql } from 'pgvector/pg';

export type RetrievedChunk = {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  clearanceLevel: number;
  similarity: number;
  // Set by lib/rag/chat.ts after merging in retrieveChunksForDocuments()
  // results — never set by this query itself. Lets a chunk the question
  // named its source document for skip the SIMILARITY_THRESHOLD cutoff even
  // when its raw cosine similarity is low (see lib/rag/documentNameMatch.ts
  // for why that happens for perfectly relevant, correctly-chunked content).
  matchedByDocumentName?: boolean;
};

/**
 * THE security-critical query in this codebase.
 *
 * The clearance filter (`dc."clearanceRank" <= userClearanceRank`) and the
 * vector similarity search run in the SAME SQL statement. There is no code
 * path — here or anywhere else in the app — where a chunk above the caller's
 * clearance is ever fetched into the Node process, let alone passed to the
 * LLM. Do not "fetch then filter in JS" this query; that would be the
 * insufficient pattern the spec explicitly calls out.
 *
 * `userClearanceRank` MUST come from a server-side, DB-verified session
 * (see lib/auth/session.ts::getAuthContext) — never from client input.
 *
 * Uses Prisma's tagged-template $queryRaw, which parameterizes every
 * interpolated value — this is not string concatenation and is not
 * SQL-injectable via `question`/embedding content. Column names are quoted
 * to match Prisma's default camelCase mapping (no @map in schema.prisma).
 */
export async function retrieveAuthorizedChunks(
  queryEmbedding: number[],
  userClearanceRank: number,
  topK = 6,
): Promise<RetrievedChunk[]> {
  const vec = toSql(queryEmbedding);

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT
      dc.id,
      dc.content,
      dc."documentId" AS "documentId",
      d.name AS "documentName",
      d."clearanceLevel" AS "clearanceLevel",
      1 - (dc.embedding <=> ${vec}::vector) AS similarity
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE dc."clearanceRank" <= ${userClearanceRank}
      AND d.status = 'READY'
    ORDER BY dc.embedding <=> ${vec}::vector
    LIMIT ${topK}
  `;
}

/**
 * Backs the citation-preview feature: a user clicks a citation chip on an
 * already-authorized answer and expects to see the actual cited text. The
 * chunk's id alone (stored on the Message row) isn't proof of current
 * authorization — clearance can change after a message was sent — so this
 * re-checks `clearanceRank <= userClearanceRank` at read time, same as
 * every other chunk access in this app, rather than trusting that a chunk
 * id showing up in a citation once means it's still safe to show now.
 */
export type ChunkForUser = {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  // 1-based PDF page / PPTX slide this chunk came from, or null (DOCX/TXT/
  // MD, or a PDF/PPTX processed before this column existed). Lets the
  // citation preview open the source document to the right spot.
  pageNumber: number | null;
  mimeType: string;
};

export async function getChunkForUser(
  chunkId: string,
  userClearanceRank: number,
): Promise<ChunkForUser | null> {
  const rows = await prisma.$queryRaw<ChunkForUser[]>`
    SELECT dc.id, dc.content, dc."documentId" AS "documentId", d.name AS "documentName",
           dc."pageNumber" AS "pageNumber", d."mimeType" AS "mimeType"
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE dc.id = ${chunkId} AND dc."clearanceRank" <= ${userClearanceRank}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Fetches chunks belonging to a specific, already-clearance-checked set of
 * documents — used when lib/rag/documentNameMatch.ts detects the question
 * directly names a document, so its content reaches the model even if its
 * chunks happen to score poorly on cosine similarity (see that module's
 * doc comment for the measured failure mode this exists to cover).
 *
 * SAME clearance filter as retrieveAuthorizedChunks — this is not a
 * separate, weaker code path. `documentIds` merely narrows WHICH documents
 * to look in; it does not bypass the clearance check for any of them.
 *
 * Capped per document (not just overall) so one huge document can't crowd
 * out a second, smaller one that was also named in the same question.
 */
export async function retrieveChunksForDocuments(
  documentIds: string[],
  queryEmbedding: number[],
  userClearanceRank: number,
  capPerDocument = 8,
): Promise<RetrievedChunk[]> {
  if (documentIds.length === 0) return [];
  const vec = toSql(queryEmbedding);

  const rows = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT id, content, "documentId", "documentName", "clearanceLevel", similarity FROM (
      SELECT
        dc.id,
        dc.content,
        dc."documentId" AS "documentId",
        d.name AS "documentName",
        d."clearanceLevel" AS "clearanceLevel",
        1 - (dc.embedding <=> ${vec}::vector) AS similarity,
        ROW_NUMBER() OVER (
          PARTITION BY dc."documentId"
          ORDER BY dc.embedding <=> ${vec}::vector
        ) AS rank
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d.id = dc."documentId"
      WHERE dc."clearanceRank" <= ${userClearanceRank}
        AND d.status = 'READY'
        AND dc."documentId" = ANY(${documentIds}::text[])
    ) ranked
    WHERE rank <= ${capPerDocument}
  `;

  return rows.map((chunk) => ({ ...chunk, matchedByDocumentName: true }));
}

/**
 * Inserts chunks + embeddings for a document, denormalizing the parent
 * document's clearance level onto every chunk. This denormalization is what
 * lets retrieveAuthorizedChunks() filter without a join being load-bearing
 * for security — the clearance check lives directly on the row being
 * ordered by similarity.
 */
export async function insertDocumentChunks(
  documentId: string,
  chunks: { index: number; content: string; pageNumber?: number | null }[],
  embeddings: number[][],
  clearanceLevel: number,
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error('chunks and embeddings length mismatch');
  }

  await prisma.$transaction(
    chunks.map((chunk, i) => {
      const vec = toSql(embeddings[i]);
      return prisma.$executeRaw`
        INSERT INTO "DocumentChunk"
          (id, "documentId", "chunkIndex", content, embedding, "clearanceRank", "pageNumber", "createdAt")
        VALUES
          (gen_random_uuid()::text, ${documentId}, ${chunk.index}, ${chunk.content}, ${vec}::vector, ${clearanceLevel}, ${chunk.pageNumber ?? null}, now())
      `;
    }),
    // Prisma's default interactive-transaction timeout is 5000ms, covering
    // the WHOLE batch, not each statement — fine against a local Postgres,
    // but confirmed directly in production against a remote DB (Neon):
    // large documents (30-40 chunks) blew past 5s purely on accumulated
    // network round-trip latency per INSERT, failing with "A rollback
    // cannot be executed on an expired transaction." Generous headroom
    // here rather than tuning it precisely to corpus size, since a
    // document's chunk count isn't bounded by anything in this app — kept
    // noticeably below the 60s maxDuration on the upload route (and the
    // admin "Replace" action's page) so a slow transaction fails with this
    // module's own clear error well before the platform kills the whole
    // request for running too long.
    { timeout: 45_000 },
  );
}

/**
 * Deletes every chunk belonging to a document without touching the Document
 * row itself — used when replacing a document's file (reprocess in place)
 * as opposed to deleting the document entirely (which cascades via the FK).
 */
export function deleteChunksForDocument(documentId: string) {
  return prisma.documentChunk.deleteMany({ where: { documentId } });
}

/**
 * The "re-indexing" the spec calls for when an admin changes a document's
 * clearance level (§18): every existing chunk's denormalized clearanceRank
 * is updated in place so retrieval immediately reflects the new level —
 * no re-embedding needed, since only the security metadata changed, not
 * the content.
 */
export function updateChunksClearanceForDocument(documentId: string, clearanceRank: number) {
  return prisma.documentChunk.updateMany({
    where: { documentId },
    data: { clearanceRank },
  });
}
