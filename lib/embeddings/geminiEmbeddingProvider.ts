import { GoogleGenAI } from '@google/genai';
import { config } from '@/lib/config';
import type { EmbeddingProvider, EmbeddingTaskType } from '@/lib/embeddings/types';

// Hosted Gemini embeddings — no local model, no ONNX runtime, no in-process
// memory footprint at all (just an HTTP call). Chosen specifically to fix a
// real production failure: LocalTransformersEmbeddingProvider running the
// embedding model in-process repeatedly exhausted a memory-constrained
// deployment host's RAM, causing the process to crash and auto-restart
// mid-request. This provider design (batched embedContent calls, the
// RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY task-type split, retry-on-transient-
// error) mirrors a working implementation already proven in production in
// a sibling project (../Linkedin/server/src/services/embeddingClient.ts) —
// not written from scratch/guessed.
//
// Constructed fresh by lib/embeddings/index.ts on every getEmbeddingProvider()
// call with whichever credentials are currently active (DB-configured via
// Admin -> AI Models, or GEMINI_API_KEY/EMBEDDING_MODEL as a fallback — see
// that file). apiKey/model are constructor params, not read from
// lib/config.ts directly, since the active credential can change between
// requests without a redeploy. `dimensions` is always
// config.EMBEDDING_DIMENSIONS — the fixed vector(N) column width every
// embedding provider in this app must honor, requested explicitly via
// Gemini's outputDimensionality parameter, never left to the model's own
// native size.

// Batching keeps request count down (Gemini's free-tier rate limits are
// per-request, not per-text) without risking an oversized single payload.
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
// 429 rate-limited, 500 internal error, 503 "currently experiencing high
// demand" — all transient, worth a short backoff-and-retry rather than
// failing the whole batch over one blip.
const RETRYABLE_STATUS = new Set([429, 500, 503]);

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = config.EMBEDDING_DIMENSIONS;
  readonly provider = 'GEMINI' as const;
  readonly model: string;
  private readonly apiKey: string;
  private client: GoogleGenAI | null = null;

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  private getClient(): GoogleGenAI {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async embed(texts: string[], taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT'): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (const batch of chunkArray(texts, BATCH_SIZE)) {
      const vectors = await this.embedBatchWithFallback(batch, taskType);
      results.push(...vectors);
    }
    return results;
  }

  // Not every Gemini embedding model actually supports multiple texts in
  // one embedContent call, despite the API accepting an array — confirmed
  // directly against the real API: gemini-embedding-001 batches correctly,
  // but gemini-embedding-2 always returns exactly 1 embedding no matter
  // how many texts are sent (2 in, 1 back; 20 in, 1 back), silently
  // discarding the rest rather than erroring or batching. There's no
  // documented way to detect this ahead of time per model, so this treats
  // a short response as a signal to fall back to one call per text for
  // this batch — slower for a model that needs it, free for one that
  // doesn't (the batched path stays the default, tried first).
  private async embedBatchWithFallback(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    if (texts.length === 1) return this.embedContentWithRetry(texts, taskType);
    try {
      return await this.embedContentWithRetry(texts, taskType);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Embedding batch size mismatch')) {
        console.warn(
          `[embeddings] ${this.model} doesn't appear to support batched embedContent calls — falling back to one call per text for this batch of ${texts.length}.`,
        );
        const singles = await Promise.all(texts.map((t) => this.embedContentWithRetry([t], taskType)));
        return singles.map((s) => s[0]);
      }
      throw err;
    }
  }

  private async embedContentWithRetry(
    texts: string[],
    taskType: EmbeddingTaskType,
    attempt = 0,
  ): Promise<number[][]> {
    try {
      const response = await this.getClient().models.embedContent({
        model: this.model,
        contents: texts,
        config: {
          outputDimensionality: config.EMBEDDING_DIMENSIONS,
          taskType,
        },
      });

      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new Error(
          `Embedding batch size mismatch: sent ${texts.length} texts, got ${embeddings.length} embeddings back.`,
        );
      }

      return embeddings.map((e, i) => {
        const values = e.values ?? [];
        if (values.length !== config.EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding dimension mismatch at index ${i}: expected ${config.EMBEDDING_DIMENSIONS} ` +
              `(EMBEDDING_DIMENSIONS) but got ${values.length}. This usually means the embedding ` +
              'model/config changed without a matching migration + re-embed of existing chunks.',
          );
        }
        return values;
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== undefined && RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS - 1) {
        const delayMs = 1500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.embedContentWithRetry(texts, taskType, attempt + 1);
      }
      if (status === 401 || status === 403) {
        throw new Error('Gemini API authentication failed — check the saved API key.');
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
