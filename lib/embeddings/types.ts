/**
 * Swap point #1 of 3 (with LLMProvider and StorageProvider). Concrete
 * implementations live alongside this file; which one is active is chosen
 * by EMBEDDING_PROVIDER in lib/config.ts / .env, via the factory in
 * index.ts. Adding a new provider (e.g. OpenAI) is a new file + one line in
 * the factory — no other code in the app should import a concrete provider
 * directly.
 */

/**
 * Gemini (and several other modern embedding APIs) train document-side and
 * query-side embeddings asymmetrically — a chunk being indexed and a
 * question being asked are pushed toward different points that then match
 * well against each other, rather than both being embedded the same way.
 * Passing the right one measurably improves retrieval quality; passing none
 * (or the wrong one) still works, just as if the model were symmetric.
 * lib/documents/pipeline.ts passes RETRIEVAL_DOCUMENT when indexing a
 * chunk; lib/rag/chat.ts passes RETRIEVAL_QUERY when embedding a question.
 * Providers that have no such concept (e.g. the local model) simply ignore
 * this parameter.
 */
export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

// Matches Prisma's AIProviderKind, but this package deliberately doesn't
// import from @prisma/client — kept as a plain string union so this file
// has no dependency on the generated client at all.
export type EmbeddingProviderKind = 'GEMINI' | 'OPENAI' | 'OLLAMA';

export interface EmbeddingProvider {
  /** Vector dimensionality this provider produces — must match the
   *  `vector(N)` column in prisma/schema.prisma and EMBEDDING_DIMENSIONS. */
  readonly dimensions: number;
  // Which provider/model actually produced a chunk's vector — stamped onto
  // every DocumentChunk at insert/re-embed time (see
  // lib/db/queries/chunks.ts's embeddingProvider/embeddingModel columns).
  // A real production incident is why this exists: switching the active
  // embedding provider does NOT retroactively re-embed already-indexed
  // chunks, and two different embedding models produce vectors in
  // genuinely different semantic spaces even at the same dimensionality —
  // comparing them with cosine similarity doesn't error, it just returns
  // near-random results. Confirmed directly: a chunk containing the exact
  // answer to a real query ranked 838th of 898 by similarity after a
  // provider switch, with the top "match" at a symmetry-breaking-noise
  // 0.15 cosine similarity. Without this fingerprint there was no way to
  // even detect that a chunk's embedding was stale, let alone fix it.
  readonly provider: EmbeddingProviderKind;
  readonly model: string;
  embed(texts: string[], taskType?: EmbeddingTaskType): Promise<number[][]>;
}
