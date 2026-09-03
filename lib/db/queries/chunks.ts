import { prisma } from '@/lib/db/prisma';
import { toSql } from 'pgvector/pg';

export type RetrievedChunk = {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  clearanceLevel: number;
  similarity: number;
  // Set only for a document added by pasting a URL — see
  // Document.sourceUrl's own comment. Carried all the way through to
  // lib/rag/chat.ts::buildCitations so a citation chip for website-sourced
  // content can link straight to the real live page instead of opening
  // the citation-preview modal (which has nothing useful to show for a
  // page that was never rendered into an internal PDF).
  sourceUrl: string | null;
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
 * A chunk is authorized if the caller's clearance rank covers it AND
 * (either the chunk has no department at all, OR the caller belongs to at
 * least one of the chunk's (denormalized) departments, OR the caller
 * belongs to a "head department" — see Department.isHeadDepartment, which
 * counts as membership in every department for this check, clearance
 * still required either way). Clearance is a hard requirement, not one
 * branch of an OR: a document set to "VP" clearance and "HR" department is
 * visible ONLY to someone who is BOTH VP-or-above AND in HR — not to every
 * VP+ employee regardless of department, and not to every HR employee
 * regardless of clearance. A document with NO department at all is
 * governed by clearance alone, exactly as if departments didn't exist —
 * the department condition only ever narrows, never widens, who a
 * clearance level already admits.
 *
 * `dc."departmentIds" && userDepartmentIds` is Postgres's array-overlap
 * operator; `cardinality(dc."departmentIds") = 0` is true only for a
 * chunk with no department. An empty `userDepartmentIds` array and
 * `hasHeadDepartmentAccess: false` both correctly fall back to pure
 * clearance with no special-casing needed.
 *
 * `userClearanceRank`/`userDepartmentIds`/`hasHeadDepartmentAccess` MUST
 * come from a server-side, DB-verified session (see
 * lib/auth/session.ts::getAuthContext) — never from client input.
 *
 * Uses Prisma's tagged-template $queryRaw, which parameterizes every
 * interpolated value — this is not string concatenation and is not
 * SQL-injectable via `question`/embedding content. Column names are quoted
 * to match Prisma's default camelCase mapping (no @map in schema.prisma).
 */
export async function retrieveAuthorizedChunks(
  queryEmbedding: number[],
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
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
      d."sourceUrl" AS "sourceUrl",
      1 - (dc.embedding <=> ${vec}::vector) AS similarity
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE dc."clearanceRank" <= ${userClearanceRank}
      AND (
        cardinality(dc."departmentIds") = 0
        OR dc."departmentIds" && ${userDepartmentIds}::text[]
        OR ${hasHeadDepartmentAccess}
      )
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
 * re-checks clearance-and-department at read time, same as every other
 * chunk access in this app, rather than trusting that a chunk id showing
 * up in a citation once means it's still safe to show now.
 */
export type ChunkForUser = {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  // 1-based page this chunk came from — a real PDF page/PPTX slide
  // number, or (DOCX/TXT/MD) a synthetic per-chunk page number into that
  // document's generated preview PDF. Null only for a chunk processed
  // before this column existed. Lets the citation preview open the
  // source document to the right spot.
  pageNumber: number | null;
  // The document's TRUE original format — always what downloads serve,
  // regardless of previewFileKey.
  mimeType: string;
  // Storage key of a generated preview PDF for a non-PDF original, or
  // null (already a PDF, or preview generation hasn't produced one yet —
  // see previewFileKey's schema doc comment). This is what the citation
  // preview actually renders when the original isn't already a PDF.
  previewFileKey: string | null;
  // Set only for a document added by pasting a URL — see
  // Document.sourceUrl's own comment. Lets the citation preview link
  // straight to the real live page instead of an internally generated
  // PDF rendition of the scraped HTML, which is what "Open full document"
  // would otherwise show for this kind of source.
  sourceUrl: string | null;
};

export async function getChunkForUser(
  chunkId: string,
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
): Promise<ChunkForUser | null> {
  const rows = await prisma.$queryRaw<ChunkForUser[]>`
    SELECT dc.id, dc.content, dc."documentId" AS "documentId", d.name AS "documentName",
           dc."pageNumber" AS "pageNumber", d."mimeType" AS "mimeType",
           d."previewFileKey" AS "previewFileKey", d."sourceUrl" AS "sourceUrl"
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d.id = dc."documentId"
    WHERE dc.id = ${chunkId}
      AND dc."clearanceRank" <= ${userClearanceRank}
      AND (
        cardinality(dc."departmentIds") = 0
        OR dc."departmentIds" && ${userDepartmentIds}::text[]
        OR ${hasHeadDepartmentAccess}
      )
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
 * SAME clearance-and-department filter as retrieveAuthorizedChunks — this
 * is not a separate, weaker code path. `documentIds` merely narrows WHICH
 * documents to look in; it does not bypass the authorization check for any
 * of them.
 *
 * Capped per document (not just overall) so one huge document can't crowd
 * out a second, smaller one that was also named in the same question.
 */
export async function retrieveChunksForDocuments(
  documentIds: string[],
  queryEmbedding: number[],
  userClearanceRank: number,
  userDepartmentIds: string[],
  hasHeadDepartmentAccess: boolean,
  capPerDocument = 8,
): Promise<RetrievedChunk[]> {
  if (documentIds.length === 0) return [];
  const vec = toSql(queryEmbedding);

  const rows = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT id, content, "documentId", "documentName", "clearanceLevel", "sourceUrl", similarity FROM (
      SELECT
        dc.id,
        dc.content,
        dc."documentId" AS "documentId",
        d.name AS "documentName",
        d."clearanceLevel" AS "clearanceLevel",
        d."sourceUrl" AS "sourceUrl",
        1 - (dc.embedding <=> ${vec}::vector) AS similarity,
        ROW_NUMBER() OVER (
          PARTITION BY dc."documentId"
          ORDER BY dc.embedding <=> ${vec}::vector
        ) AS rank
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d.id = dc."documentId"
      WHERE dc."clearanceRank" <= ${userClearanceRank}
        AND (
          cardinality(dc."departmentIds") = 0
          OR dc."departmentIds" && ${userDepartmentIds}::text[]
          OR ${hasHeadDepartmentAccess}
        )
        AND d.status = 'READY'
        AND dc."documentId" = ANY(${documentIds}::text[])
    ) ranked
    WHERE rank <= ${capPerDocument}
  `;

  return rows.map((chunk) => ({ ...chunk, matchedByDocumentName: true }));
}

/**
 * Inserts chunks + embeddings for a document, denormalizing the parent
 * document's clearance level AND departments onto every chunk. This
 * denormalization is what lets retrieveAuthorizedChunks() filter without a
 * join being load-bearing for security — the authorization check lives
 * directly on the row being ordered by similarity.
 */
export async function insertDocumentChunks(
  documentId: string,
  chunks: { index: number; content: string; pageNumber?: number | null }[],
  embeddings: number[][],
  clearanceLevel: number,
  departmentIds: string[] = [],
  // Which provider/model actually produced `embeddings` — see
  // EmbeddingProvider's own comment for why this is tracked. Optional only
  // so existing call sites keep compiling; every real caller should pass
  // it (lib/documents/pipeline.ts does).
  embeddingProvider?: 'ANTHROPIC' | 'GEMINI' | 'OPENAI' | 'OLLAMA',
  embeddingModel?: string,
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error('chunks and embeddings length mismatch');
  }

  await prisma.$transaction(
    chunks.map((chunk, i) => {
      const vec = toSql(embeddings[i]);
      return prisma.$executeRaw`
        INSERT INTO "DocumentChunk"
          (id, "documentId", "chunkIndex", content, embedding, "clearanceRank", "departmentIds", "pageNumber", "embeddingProvider", "embeddingModel", "createdAt")
        VALUES
          (gen_random_uuid()::text, ${documentId}, ${chunk.index}, ${chunk.content}, ${vec}::vector, ${clearanceLevel}, ${departmentIds}::text[], ${chunk.pageNumber ?? null}, ${embeddingProvider ?? null}::"AIProviderKind", ${embeddingModel ?? null}, now())
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

/**
 * Same re-indexing as updateChunksClearanceForDocument, for the department
 * side: called whenever an admin changes which departments a document is
 * tagged with, so retrieval reflects the new set immediately.
 */
export function updateChunksDepartmentsForDocument(documentId: string, departmentIds: string[]) {
  return prisma.documentChunk.updateMany({
    where: { documentId },
    data: { departmentIds },
  });
}

/**
 * How many chunks were embedded with something OTHER than the currently
 * active embedding provider/model — including every chunk indexed before
 * this tracking existed (embeddingProvider IS NULL). These are the chunks
 * whose vectors live in a different semantic space than a query embedded
 * right now, so similarity search against them is closer to random than
 * relevant (see EmbeddingProvider's own comment for the real incident this
 * measures). Surfaced as a banner + count on the admin side so staleness
 * is visible before someone notices via a wrong "not enough information"
 * chat answer, the way it was first discovered here.
 */
export async function countStaleEmbeddings(activeProvider: string, activeModel: string): Promise<number> {
  return prisma.documentChunk.count({
    where: {
      OR: [{ embeddingProvider: null }, { embeddingProvider: { not: activeProvider as never } }, { embeddingModel: { not: activeModel } }],
    },
  });
}

export type StaleChunk = { id: string; content: string };

/**
 * One bounded batch of stale chunk ids/content to re-embed — bounded
 * rather than "all of them" because re-embedding calls a real external API
 * per batch and this app's admin actions share the same maxDuration as
 * every other route (see app/(app)/knowledge-base/page.tsx's own comment);
 * the calling action re-invokes this repeatedly until it returns fewer
 * than `limit` rows, each round re-authenticated by nothing further since
 * the whole operation was already authorized once at the start (see
 * reembedStaleChunksAction's own comment).
 */
export function listStaleChunkBatch(activeProvider: string, activeModel: string, limit: number): Promise<StaleChunk[]> {
  return prisma.documentChunk.findMany({
    where: {
      OR: [{ embeddingProvider: null }, { embeddingProvider: { not: activeProvider as never } }, { embeddingModel: { not: activeModel } }],
    },
    select: { id: true, content: true },
    take: limit,
  });
}

/**
 * Writes back freshly-computed vectors for a batch of chunks and stamps
 * the provider/model that produced them, in one transaction per batch —
 * mirrors insertDocumentChunks's own per-row $executeRaw pattern (Prisma
 * can't express the vector column any other way).
 */
export async function updateChunkEmbeddings(
  updates: { id: string; embedding: number[]; provider: string; model: string }[],
): Promise<void> {
  await prisma.$transaction(
    updates.map(({ id, embedding, provider, model }) => {
      const vec = toSql(embedding);
      return prisma.$executeRaw`
        UPDATE "DocumentChunk"
        SET embedding = ${vec}::vector, "embeddingProvider" = ${provider}::"AIProviderKind", "embeddingModel" = ${model}
        WHERE id = ${id}
      `;
    }),
    { timeout: 45_000 },
  );
}
