import type { EmbeddingProvider } from '@/lib/embeddings/types';

/**
 * Stub for future use. Wire this up when moving off the local free provider:
 * call OpenAI's embeddings endpoint (e.g. text-embedding-3-small, 1536-dim)
 * for each batch of `texts`, and update EMBEDDING_DIMENSIONS + the
 * `vector(N)` column in prisma/schema.prisma to match (dimension changes
 * require a migration and re-embedding existing chunks — the two aren't
 * interchangeable in the same column).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;

  embed(): Promise<number[][]> {
    throw new Error(
      'OpenAIEmbeddingProvider is not implemented yet. Set EMBEDDING_PROVIDER=local, ' +
        'or implement this provider before switching.',
    );
  }
}
