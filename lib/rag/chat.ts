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
import { extractCitedChunkIds } from '@/lib/llm/shared';
import { CHAT_SYSTEM_PROMPT, NO_AUTHORIZED_INFO_ANSWER } from '@/lib/llm/promptTemplates';
import { logAuditEvent } from '@/lib/audit/log';
import type { ChatTurn } from '@/lib/llm/types';

const SIMILARITY_THRESHOLD = 0.3;
// Last N history messages fed to the query-condensing step (~3 exchanges)
// — enough to resolve almost any real follow-up's pronouns/implicit
// references, small enough to keep that call fast and cheap rather than
// growing with the whole conversation. Retrieval quality on a follow-up
// depends on the last couple of turns' topic, not the full transcript.
const MAX_CONDENSE_HISTORY_MESSAGES = 6;
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
type RetrievedContext = {
  relevant: RetrievedChunk[];
  documentInventory: { name: string; description: string | null }[];
  // The text actually embedded for retrieval — equal to `question` on a
  // first message or whenever condensing declined/failed, or a rewritten
  // standalone version on a follow-up turn. Threaded out so the caller can
  // log it (only when it actually differs — see logChatQueryAudit) without
  // retrieveContext needing to know anything about audit logging itself.
  retrievalQuery: string;
};

/**
 * Rewrites a follow-up question into a standalone one before it's embedded
 * for retrieval — e.g. "what about the pricing?" right after a question
 * about a specific project becomes "what is the pricing for [project]?".
 * Embedding the raw follow-up alone finds nothing relevant, since it
 * lacks the entity/topic actually being asked about; this is what makes a
 * multi-turn conversation retrieve as well as a single, fully-specified
 * question would.
 *
 * Returns `question` unchanged, with no LLM call at all, whenever there's
 * no history to condense against — the common first-message-in-a-
 * conversation case pays nothing for this feature. On any failure
 * (provider error, quota, network), falls back to the raw question rather
 * than failing the turn — this is a retrieval quality improvement, not
 * something the chat should ever break over.
 */
async function buildRetrievalQuery(conversationHistory: ChatTurn[], question: string): Promise<string> {
  if (conversationHistory.length === 0) return question;
  try {
    const llm = getLLMProvider();
    const recentHistory = conversationHistory.slice(-MAX_CONDENSE_HISTORY_MESSAGES);
    return await llm.condenseQuestion(recentHistory, question);
  } catch (err) {
    console.error('[rag] condenseQuestion failed, retrieving with the raw question instead', err);
    return question;
  }
}

/**
 * Steps 1–2 of the flow documented above, shared by both answerQuestion()
 * (non-streaming) and streamAnswer() (streaming) — the retrieval and
 * authorization logic must behave identically regardless of which transport
 * the answer is delivered over, so it lives in exactly one place.
 *
 * Does NOT write the CHAT_QUERY audit event itself (it used to) — that now
 * happens in logChatQueryAudit, called by answerQuestion/streamAnswer once
 * the model's actual answer is known, since Feature 4's "did this question
 * get a real answer" tracking needs the answer text, which doesn't exist
 * yet at this point in the flow.
 */
async function retrieveContext(
  ctx: AuthContext,
  question: string,
  conversationHistory: ChatTurn[],
  scopedDocumentIds?: string[],
): Promise<RetrievedContext> {
  const retrievalQuery = await buildRetrievalQuery(conversationHistory, question);

  const embedder = getEmbeddingProvider();
  const [queryEmbedding] = await embedder.embed([retrievalQuery], 'RETRIEVAL_QUERY');

  // Document *names/descriptions*, not content — fetched every turn now,
  // regardless of whether vector retrieval also found relevant chunk
  // content, so a meta-question about the document collection ("name them
  // all") gets answered correctly even on a turn where retrieval happened
  // to also clear the similarity threshold for a few generically-similar
  // (but not actually useful) chunks. See CHAT_SYSTEM_PROMPT for why the
  // old relevant.length === 0 gate was a real bug. Filtered by the same
  // clearance rule as chunk retrieval. Also doubles as the candidate list
  // for matchDocumentsByName below. Fetched even in scoped mode (below) —
  // harmless, and still lets the model reason about "what else exists".
  const accessibleDocuments = await listAccessibleDocumentSummaries(ctx.clearanceRank);
  const documentInventory = accessibleDocuments.map(({ name, description }) => ({ name, description }));

  // The user explicitly picked which document(s) to answer from (Feature 3
  // — a chat-composer document picker) — skip corpus-wide vector search
  // and name-matching entirely and pull only from the picked set.
  // retrieveChunksForDocuments re-checks clearance in SQL regardless of
  // what ids are passed, so a tampered/inaccessible id just yields zero
  // chunks for it, never a bypass — same boundary as every other path.
  if (scopedDocumentIds && scopedDocumentIds.length > 0) {
    const relevant = await retrieveChunksForDocuments(scopedDocumentIds, queryEmbedding, ctx.clearanceRank);
    return { relevant, documentInventory, retrievalQuery };
  }

  const vectorChunks = await retrieveAuthorizedChunks(queryEmbedding, ctx.clearanceRank, TOP_K);

  // If the question directly names one of this user's authorized documents
  // (e.g. "what tools were used in the Rent project"), pull that document's
  // chunks directly rather than trusting embedding similarity alone to
  // surface them — see lib/rag/documentNameMatch.ts for the measured,
  // reproducible embedding-quality failure this covers (a real chunk,
  // correctly formed, containing exactly the asked-about content, that
  // still didn't crack the top 40 of 355 chunks corpus-wide, NOR the top 7
  // of 9 within its own document, on cosine similarity alone). Matched
  // against retrievalQuery, not the raw question — a condensed follow-up
  // can newly contain a document name the raw fragment alone never would
  // (e.g. "what about the pricing?" -> "what is the pricing for the Rent
  // project?"), which is a real retrieval win, not just consistency.
  const matchedDocumentIds = matchDocumentsByName(retrievalQuery, accessibleDocuments);
  const nameMatchedChunks = await retrieveChunksForDocuments(
    matchedDocumentIds,
    queryEmbedding,
    ctx.clearanceRank,
  );

  const chunks = mergeChunks(vectorChunks, nameMatchedChunks);
  const relevant = chunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD || c.matchedByDocumentName);

  return { relevant, documentInventory, retrievalQuery };
}

/**
 * The single place CHAT_QUERY gets logged — called once each from
 * answerQuestion/streamAnswer, after the model's answer text is already
 * known (see retrieveContext's doc comment for why this moved out of
 * there). `gotNoAuthorizedInfoAnswer` is what Feature 4's gap-tracking
 * filters on: a real signal that this question hit a genuine content gap,
 * not a guess from retrieval stats alone.
 *
 * Checked with startsWith, not ===: NO_AUTHORIZED_INFO_ANSWER is always
 * the literal first sentence of a class-B-fallback answer (see
 * CHAT_SYSTEM_PROMPT's rule B), but the model may now continue past it
 * into a labeled general-knowledge answer for the same question when the
 * topic genuinely has a real-world equivalent. The document gap is real
 * either way — an admin should still see it flagged even when the user
 * also got a helpful general-knowledge answer for their immediate
 * question — so this only needs to detect that the fallback sentence
 * opened the answer, not that it was the whole answer.
 */
async function logChatQueryAudit(
  ctx: AuthContext,
  conversationId: string,
  question: string,
  retrievalQuery: string,
  relevant: RetrievedChunk[],
  answerText: string,
  scopedDocumentIds?: string[],
): Promise<void> {
  const gotNoAuthorizedInfoAnswer = answerText.startsWith(NO_AUTHORIZED_INFO_ANSWER);
  await logAuditEvent({
    action: 'CHAT_QUERY',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: conversationId,
    metadata: {
      userClearanceRank: ctx.clearanceRank,
      retrievedChunkIds: relevant.map((c) => c.id),
      question,
      gotNoAuthorizedInfoAnswer,
      // Only recorded when condensing actually changed the query (i.e.
      // ran, and produced something different) — keeps every single-turn
      // entry from carrying a redundant duplicate of `question`, while
      // still letting retrieval quality on multi-turn conversations be
      // debugged later from the audit log.
      ...(retrievalQuery !== question ? { retrievalQuery } : {}),
      ...(scopedDocumentIds && scopedDocumentIds.length > 0 ? { scopedDocumentIds } : {}),
    },
  });
}

export async function answerQuestion(
  ctx: AuthContext,
  conversationId: string,
  question: string,
  conversationHistory: ChatTurn[],
  scopedDocumentIds?: string[],
): Promise<AnswerResult> {
  const { relevant, documentInventory, retrievalQuery } = await retrieveContext(
    ctx,
    question,
    conversationHistory,
    scopedDocumentIds,
  );

  const llm = getLLMProvider();
  const { text, citedChunkIds } = await llm.generateAnswer({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    contextChunks: relevant,
    conversationHistory,
    question, // the original question — retrievalQuery is retrieval-only, never shown/sent to the model as "the question"
    documentInventory,
  });

  const citations = buildCitations(relevant, citedChunkIds);
  await logChatQueryAudit(ctx, conversationId, question, retrievalQuery, relevant, text, scopedDocumentIds);

  return { text, citations };
}

/**
 * Streaming counterpart of answerQuestion(): same retrieval/authorization
 * path (retrieveContext), but yields raw text deltas as the model produces
 * them instead of waiting for the full answer. Citation refs (e.g. "[3]")
 * can straddle delta boundaries, so citations are only computed once
 * streaming ends — from the fully-accumulated text — and handed back as
 * this generator's return value (not a yielded event), which callers get by
 * driving the iterator manually (`await gen.next()`) rather than a plain
 * `for await` loop. See app/api/chat/stream/route.ts for that consumer.
 */
export async function* streamAnswer(
  ctx: AuthContext,
  conversationId: string,
  question: string,
  conversationHistory: ChatTurn[],
  scopedDocumentIds?: string[],
): AsyncGenerator<string, AnswerResult, void> {
  const { relevant, documentInventory, retrievalQuery } = await retrieveContext(
    ctx,
    question,
    conversationHistory,
    scopedDocumentIds,
  );

  const llm = getLLMProvider();
  let fullText = '';
  for await (const delta of llm.generateAnswerStream({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    contextChunks: relevant,
    conversationHistory,
    question, // the original question — retrievalQuery is retrieval-only, never shown/sent to the model as "the question"
    documentInventory,
  })) {
    fullText += delta;
    yield delta;
  }

  const citedChunkIds = extractCitedChunkIds(fullText, relevant);
  const citations = buildCitations(relevant, citedChunkIds);
  // After the last yield — every token the client will see has already
  // been sent, so this await adds no perceived latency to the stream.
  await logChatQueryAudit(ctx, conversationId, question, retrievalQuery, relevant, fullText, scopedDocumentIds);

  return { text: fullText, citations };
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
