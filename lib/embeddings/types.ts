/**
 * Swap point #1 of 3 (with LLMProvider and StorageProvider). Concrete
 * implementations live alongside this file; which one is active is chosen
 * by EMBEDDING_PROVIDER in lib/config.ts / .env, via the factory in
 * index.ts. Adding a new provider (e.g. OpenAI) is a new file + one line in
 * the factory — no other code in the app should import a concrete provider
 * directly.
 */
export interface EmbeddingProvider {
  /** Vector dimensionality this provider produces — must match the
   *  `vector(N)` column in prisma/schema.prisma and EMBEDDING_DIMENSIONS. */
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
