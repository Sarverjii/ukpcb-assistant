import type { AuthContext } from '@/lib/auth/session';
import {
  retrieveAuthorizedChunks,
  retrieveChunksForDocuments,
  type RetrievedChunk,
} from '@/lib/db/queries/chunks';
import { listAccessibleDocumentSummaries } from '@/lib/db/queries/documents';
import { matchDocumentsByName } from '@/lib/rag/documentNameMatch';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLLMProvider } from '@/lib/llm';
import { CHAT_SYSTEM_PROMPT } from '@/lib/llm/promptTemplates';
import { logAuditEvent } from '@/lib/audit/log';
import type { ChatTurn } from '@/lib/llm/types';

const SIMILARITY_THRESHOLD = 0.3;
// Was 6 — too small for the corpus this now actually holds (35 documents,
// 353 chunks). Confirmed directly: for "how many projects have we worked
// on", the one chunk that actually answers it (a stats overview — "500+
// clients", "450+ Websites developed") scored 0.3363, comfortably above
// SIMILARITY_THRESHOLD, but ranked #17 — so LIMIT 6 discarded it before the
// threshold filter ever got to see it. Raising this doesn't loosen what
// counts as "relevant" (SIMILARITY_THRESHOLD still does that job); it just
// stops truncating the candidate pool before a real match can reach it.
// 20 chunks of ~1000 chars is a small fraction of Gemini's context window.
const TOP_K = 20;

export type Citation = { documentId: string; documentName: string; chunkId: string };

export type AnswerResult = { text: string; citations: Citation[] };

/**
 * The full RAG-to-Claude flow, and the place that ties together every layer
 * of the authorization story:
 *
 *   1. Takes `ctx` as a parameter rather than calling getAuthContext()
 *      itself — the caller (a server action / route handler) is responsible
 *      for deriving it fresh from the DB-backed session on every request.
 *      This is also what makes the security property in tests/authz.test.ts
 *      directly testable: the test can call answerQuestion() with an
 *      AuthContext for each clearance level without needing a real HTTP
 *      session.
 *   2. retrieveAuthorizedChunks() enforces the clearance boundary AT THE SQL
 *      LEVEL — nothing above ctx.clearanceRank is ever fetched.
 *      retrieveChunksForDocuments() (used when matchDocumentsByName finds
 *      the question names a document directly) enforces the exact same
 *      clearance filter — it is a second entry point into the same
 *      boundary, never a bypass of it. See lib/rag/documentNameMatch.ts for
 *      why this second path exists: a measured embedding-quality gap where
 *      genuinely relevant, correctly-formed content doesn't rank highly
 *      enough on cosine similarity alone to reach the model.
 *   3. The LLM is always called, with a single system prompt
 *      (CHAT_SYSTEM_PROMPT) — never skipped — so it can answer general
 *      questions ("what's 2+2", small talk) intelligently instead of
 *      refusing everything. `contextChunks` (retrieved content, may be
 *      empty) and `documentInventory` (clearance-filtered document
 *      names/descriptions, always fetched — metadata only, never content)
 *      are BOTH always passed; the model decides which source answers the
 *      question, per CHAT_SYSTEM_PROMPT's rules, rather than the app
 *      pre-deciding based on whether semantic similarity happened to clear
 *      SIMILARITY_THRESHOLD (a similarity match is a poor proxy for "is
 *      this a meta-question about the document collection", and gating
 *      documentInventory on it caused a real bug: "how many documents do
 *      you have" got a real answer, but "name them all" — asked right
 *      after, in the same conversation — got the generic refusal, because
 *      that question happened to match a few irrelevant chunks above
 *      threshold and lost access to the inventory as a result). The
 *      confidentiality guarantee never depended on any of this routing —
 *      it depends only on the LLM never receiving unauthorized chunk
 *      content or document names, which holds regardless of what `relevant`
 *      contains on a given turn.
 *   4. Citations are built by intersecting the model's cited ref numbers
 *      against the already-authorized `relevant` list, so it is structurally
 *      impossible to cite a document the caller isn't cleared for. When
 *      `relevant` is empty, citations are always empty too.
 */
export async function answerQuestion(
  ctx: AuthContext,
  conversationId: string,
  question: string,
  conversationHistory: ChatTurn[],
): Promise<AnswerResult> {
  const embedder = getEmbeddingProvider();
  const [queryEmbedding] = await embedder.embed([question], 'RETRIEVAL_QUERY');

  // Document *names/descriptions*, not content — fetched every turn now,
  // regardless of whether vector retrieval also found relevant chunk
  // content, so a meta-question about the document collection ("name them
  // all") gets answered correctly even on a turn where retrieval happened
  // to also clear the similarity threshold for a few generically-similar
  // (but not actually useful) chunks. See CHAT_SYSTEM_PROMPT for why the
  // old relevant.length === 0 gate was a real bug. Filtered by the same
  // clearance rule as chunk retrieval. Also doubles as the candidate list
  // for matchDocumentsByName below.
  const accessibleDocuments = await listAccessibleDocumentSummaries(ctx.clearanceRank);

  const vectorChunks = await retrieveAuthorizedChunks(queryEmbedding, ctx.clearanceRank, TOP_K);

  // If the question directly names one of this user's authorized documents
  // (e.g. "what tools were used in the Rent project"), pull that document's
  // chunks directly rather than trusting embedding similarity alone to
  // surface them — see lib/rag/documentNameMatch.ts for the measured,
  // reproducible embedding-quality failure this covers (a real chunk,
  // correctly formed, containing exactly the asked-about content, that
  // still didn't crack the top 40 of 355 chunks corpus-wide, NOR the top 7
  // of 9 within its own document, on cosine similarity alone).
  const matchedDocumentIds = matchDocumentsByName(question, accessibleDocuments);
  const nameMatchedChunks = await retrieveChunksForDocuments(
    matchedDocumentIds,
    queryEmbedding,
    ctx.clearanceRank,
  );

  const chunks = mergeChunks(vectorChunks, nameMatchedChunks);
  const relevant = chunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD || c.matchedByDocumentName);

  await logAuditEvent({
    action: 'CHAT_QUERY',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: conversationId,
    metadata: {
      userClearanceRank: ctx.clearanceRank,
      retrievedChunkIds: relevant.map((c) => c.id),
      question,
    },
  });

  const documentInventory = accessibleDocuments.map(({ name, description }) => ({ name, description }));

  const llm = getLLMProvider();
  const { text, citedChunkIds } = await llm.generateAnswer({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    contextChunks: relevant,
    conversationHistory,
    question,
    documentInventory,
  });

  const citations = buildCitations(relevant, citedChunkIds);

  return { text, citations };
}

/**
 * Dedupes vector-search and document-name-matched chunk lists by id. A
 * chunk found by both keeps its real similarity score but is still flagged
 * matchedByDocumentName so it can never be dropped by the threshold filter
 * just because the merge happened to see the vector copy first.
 */
function mergeChunks(vectorChunks: RetrievedChunk[], nameMatchedChunks: RetrievedChunk[]): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const c of vectorChunks) byId.set(c.id, c);
  for (const c of nameMatchedChunks) {
    const existing = byId.get(c.id);
    byId.set(c.id, existing ? { ...existing, matchedByDocumentName: true } : c);
  }
  return [...byId.values()];
}

function buildCitations(relevant: RetrievedChunk[], citedChunkIds: string[]): Citation[] {
  const citedSet = new Set(citedChunkIds);
  const cited = relevant.filter((c) => citedSet.has(c.id));

  // A single source document is very often split into multiple cited
  // chunks (e.g. the model draws on two different passages of the same
  // case study, [1] and [3]) — deduping by documentId here means the UI
  // shows one citation chip per *source*, not one per chunk. Rendering
  // the same document name twice side by side reads as a bug to a user
  // even though it was technically two distinct (authorized) chunks.
  // Found by actually inspecting a real multi-chunk citation in the UI,
  // not anticipated up front.
  const seen = new Set<string>();
  const deduped: Citation[] = [];
  for (const c of cited) {
    if (seen.has(c.documentId)) continue;
    seen.add(c.documentId);
    deduped.push({ documentId: c.documentId, documentName: c.documentName, chunkId: c.id });
  }
  return deduped;
}
