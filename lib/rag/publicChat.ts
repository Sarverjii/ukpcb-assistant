import { retrievePublicChunks } from '@/lib/db/queries/chunks';
import { listPublicDocumentSummaries } from '@/lib/db/queries/documents';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLLMProvider } from '@/lib/llm';
import { extractCitedChunkIds } from '@/lib/llm/shared';
import {
  PUBLIC_CHAT_SYSTEM_PROMPT,
  PUBLIC_NO_AUTHORIZED_INFO_ANSWER,
  GENERAL_KNOWLEDGE_CONTINUATION_LABEL,
} from '@/lib/llm/promptTemplates';
import { logAuditEvent } from '@/lib/audit/log';
import type { ChatTurn, LLMProvider } from '@/lib/llm/types';
import type { RetrievedChunk } from '@/lib/db/queries/chunks';
import type { Citation, AnswerResult } from '@/lib/rag/chat';

// Same threshold as the employee chat's SIMILARITY_THRESHOLD
// (lib/rag/chat.ts) — no reason for the public corpus to apply a
// different bar for "relevant enough to show the model".
const SIMILARITY_THRESHOLD = 0.3;

// Deliberately much smaller than the employee chat's TOP_K (150) — the
// public content pool (Admin → Public Content) is, by design, a small,
// hand-curated set of pages/documents, nowhere near the hundreds-of-
// documents corpus that constant was raised for. Revisit if that ever
// changes.
const TOP_K = 30;

/**
 * The public chat's own retrieval step — structurally the employee chat's
 * retrieveContext() (lib/rag/chat.ts), stripped to what a caller with NO
 * identity at all can still do: no clearance/department/location, no
 * query-condensing history beyond what the client itself sends back each
 * turn (nothing is persisted server-side for the public chat — see
 * app/api/public-chat/stream/route.ts's own comment), and no document-
 * name-matching second retrieval path (lib/rag/documentNameMatch.ts) —
 * that path exists to cover a measured embedding-quality gap on a large,
 * hundreds-of-documents corpus; the small public pool doesn't need it.
 */
async function retrievePublicContext(
  question: string,
): Promise<{ relevant: RetrievedChunk[]; documentInventory: { name: string; description: string | null }[] }> {
  const embedder = await getEmbeddingProvider();
  const [queryEmbedding] = await embedder.embed([question], 'RETRIEVAL_QUERY');

  const [vectorChunks, accessibleDocuments] = await Promise.all([
    retrievePublicChunks(queryEmbedding, TOP_K),
    listPublicDocumentSummaries(),
  ]);

  const relevant = vectorChunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD);
  const documentInventory = accessibleDocuments.map(({ name, description }) => ({ name, description }));

  return { relevant, documentInventory };
}

/**
 * Mirrors lib/rag/chat.ts::logChatQueryAudit for the public surface —
 * same CHAT_QUERY action and gap-tracking shape, but userId is omitted
 * (there is no user) and `ip`/`public: true` are recorded instead, so an
 * admin reviewing the audit log can immediately tell a public-chat entry
 * apart from an employee one.
 */
async function logPublicChatQueryAudit(
  question: string,
  relevant: RetrievedChunk[],
  answerText: string,
  ip: string,
): Promise<void> {
  const gotNoAuthorizedInfoAnswer = answerText.startsWith(PUBLIC_NO_AUTHORIZED_INFO_ANSWER);
  await logAuditEvent({
    action: 'CHAT_QUERY',
    result: 'SUCCESS',
    metadata: {
      public: true,
      ip,
      retrievedChunkIds: relevant.map((c) => c.id),
      question,
      gotNoAuthorizedInfoAnswer,
    },
  });
}

/** Same two-layer fallback as lib/rag/chat.ts::tryGeneralKnowledgeFallback, against the public fallback sentence instead of the employee one. */
async function tryGeneralKnowledgeFallback(llm: LLMProvider, question: string, text: string): Promise<string> {
  if (text !== PUBLIC_NO_AUTHORIZED_INFO_ANSWER) return text;
  try {
    const continuation = await llm.generalKnowledgeFallback(question);
    if (!continuation) return text;
    return `${text}\n\n${GENERAL_KNOWLEDGE_CONTINUATION_LABEL}\n\n${continuation}`;
  } catch (err) {
    console.error('[rag] public generalKnowledgeFallback failed, keeping the bare document-gap answer', err);
    return text;
  }
}

function buildCitations(relevant: RetrievedChunk[], citedChunkIds: string[]): Citation[] {
  const citedSet = new Set(citedChunkIds);
  const cited = relevant.filter((c) => citedSet.has(c.id));
  const seen = new Set<string>();
  const deduped: Citation[] = [];
  for (const c of cited) {
    if (seen.has(c.documentId)) continue;
    seen.add(c.documentId);
    deduped.push({ documentId: c.documentId, documentName: c.documentName, chunkId: c.id, sourceUrl: c.sourceUrl });
  }
  return deduped;
}

/**
 * Non-streaming public answer — kept alongside streamPublicAnswer below
 * for the same reason lib/rag/chat.ts keeps both: a future non-streaming
 * caller (tests included) shouldn't have to duplicate this logic. The live
 * public chat UI uses the streaming route exclusively.
 */
export async function answerPublicQuestion(question: string, ip: string): Promise<AnswerResult> {
  const { relevant, documentInventory } = await retrievePublicContext(question);

  const llm = await getLLMProvider();
  const { text: rawText, citedChunkIds } = await llm.generateAnswer({
    systemPrompt: PUBLIC_CHAT_SYSTEM_PROMPT,
    contextChunks: relevant,
    conversationHistory: [],
    question,
    documentInventory,
  });

  const citations = buildCitations(relevant, citedChunkIds);
  const text = await tryGeneralKnowledgeFallback(llm, question, rawText);
  await logPublicChatQueryAudit(question, relevant, text, ip);

  return { text, citations };
}

/**
 * Streaming counterpart — mirrors lib/rag/chat.ts::streamAnswer exactly,
 * minus everything that depends on a real conversation/AuthContext.
 * `conversationHistory` comes straight from the client on every turn (see
 * app/api/public-chat/stream/route.ts) since nothing is persisted
 * server-side for this surface.
 */
export async function* streamPublicAnswer(
  question: string,
  conversationHistory: ChatTurn[],
  ip: string,
): AsyncGenerator<string, AnswerResult, void> {
  const { relevant, documentInventory } = await retrievePublicContext(question);

  const llm = await getLLMProvider();
  let fullText = '';
  for await (const delta of llm.generateAnswerStream({
    systemPrompt: PUBLIC_CHAT_SYSTEM_PROMPT,
    contextChunks: relevant,
    conversationHistory,
    question,
    documentInventory,
  })) {
    fullText += delta;
    yield delta;
  }

  const citedChunkIds = extractCitedChunkIds(fullText, relevant);
  const citations = buildCitations(relevant, citedChunkIds);

  const extended = await tryGeneralKnowledgeFallback(llm, question, fullText);
  if (extended !== fullText) {
    yield extended.slice(fullText.length);
    fullText = extended;
  }

  await logPublicChatQueryAudit(question, relevant, fullText, ip);

  return { text: fullText, citations };
}
