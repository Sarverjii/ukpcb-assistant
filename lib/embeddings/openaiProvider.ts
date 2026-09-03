import { config } from '@/lib/config';
import type { EmbeddingProvider } from '@/lib/embeddings/types';

// OpenAI's hosted embeddings API — a plain REST call via fetch rather than
// the `openai` SDK package, matching this app's existing "no new
// dependency for a single JSON endpoint" pattern (see ollamaProvider.ts).
// text-embedding-3-small/large both support a `dimensions` parameter
// (Matryoshka representation learning — the model can be truncated to a
// smaller size without retraining), requested here as
// config.EMBEDDING_DIMENSIONS explicitly: the fixed vector(N) column width
// every embedding provider in this app must honor, so switching to OpenAI
// from Gemini (both requested at the same 768) stays schema-compatible —
// no migration, no re-embedding just to change providers.
//
// Constructed fresh by lib/embeddings/index.ts on every getEmbeddingProvider()
// call with whichever credentials are currently active (DB-configured via
// Admin -> AI Models, or OPENAI_API_KEY/EMBEDDING_MODEL as a fallback — see
// that file).
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const BATCH_SIZE = 100;

type OpenAIEmbeddingsResponse = {
  data?: { embedding: number[]; index: number }[];
  error?: { message: string };
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = config.EMBEDDING_DIMENSIONS;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (const batch of chunkArray(texts, BATCH_SIZE)) {
      results.push(...(await this.embedBatch(batch)));
    }
    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    let res: Response;
    try {
      res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: config.EMBEDDING_DIMENSIONS,
        }),
      });
    } catch {
      throw new Error('Could not reach the OpenAI embeddings API — check network connectivity.');
    }

    const data = (await res.json()) as OpenAIEmbeddingsResponse;

    if (res.status === 401 || res.status === 403) {
      throw new Error('OpenAI API authentication failed — check the saved API key.');
    }
    if (!res.ok || !data.data) {
      throw new Error(`OpenAI embeddings error: ${data.error?.message ?? res.statusText}`);
    }
    if (data.data.length !== texts.length) {
      throw new Error(
        `Embedding batch size mismatch: sent ${texts.length} texts, got ${data.data.length} embeddings back.`,
      );
    }

    // OpenAI's response items carry their own `index` — sort by it rather
    // than trusting array order, since the API doesn't explicitly
    // guarantee it matches input order (it always has in practice, but
    // this costs nothing and removes the assumption).
    return [...data.data]
      .sort((a, b) => a.index - b.index)
      .map((item, i) => {
        if (item.embedding.length !== config.EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding dimension mismatch at index ${i}: expected ${config.EMBEDDING_DIMENSIONS} ` +
              `(EMBEDDING_DIMENSIONS) but got ${item.embedding.length}. This usually means the ` +
              'embedding model/config changed without a matching migration + re-embed of existing chunks.',
          );
        }
        return item.embedding;
      });
  }
}
