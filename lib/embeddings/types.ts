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

export interface EmbeddingProvider {
  /** Vector dimensionality this provider produces — must match the
   *  `vector(N)` column in prisma/schema.prisma and EMBEDDING_DIMENSIONS. */
  readonly dimensions: number;
  embed(texts: string[], taskType?: EmbeddingTaskType): Promise<number[][]>;
}
