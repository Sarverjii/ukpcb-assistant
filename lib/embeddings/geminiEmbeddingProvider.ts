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

// Batching keeps the number of HTTP calls down and stays well clear of any
// per-request payload ceiling — but does NOT, on its own, protect against
// the free-tier rate limit, which was confirmed directly (a controlled
// test against the real API: five successive batches of 20 texts each
// succeeded — 100 texts total — and the sixth batch, which would have
// brought the running total to 120, failed with a 429) to be counted per
// EMBEDDED TEXT, not per HTTP call, despite Google's own quota metric
// being named "...Requests..." (generativelanguage.googleapis.com/
// embed_content_free_tier_requests, quotaValue "100", PerMinute). A single
// large document (a real 145-page PDF, ~700+ chunks after splitting) was
// confirmed to hit this instantly and permanently on every retry — ~35
// batches of 20 fired back-to-back blows through 100 texts/minute in the
// first handful of batches no matter how many times it's retried or which
// key is used, since the problem is the document's size against this
// ceiling, not the key. See BATCH_MIN_INTERVAL_MS below for the fix.
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

// Paces successive BATCHED calls (the normal, default path — see embed()
// below) so a large document's total embedded-text count stays under the
// free tier's 100/minute ceiling instead of blowing through it in the
// first few batches. At BATCH_SIZE 20, four batches a minute is 80
// texts/minute — real headroom below 100 for the same reason
// FALLBACK_MIN_INTERVAL_MS below leaves headroom: concurrent production
// traffic (live chat, a different document's own processing) shares the
// same per-minute ceiling and isn't paused during a bulk re-embed.
const BATCH_MIN_INTERVAL_MS = 15_000;

// The per-text fallback path (see embedBatchWithFallback) issues one
// embedContent call per text instead of one per batch, for a model whose
// batched response silently doesn't match what was sent — pacing that at
// one call every 700ms (~85/min) stays under the same per-text ceiling
// documented above, with the same kind of headroom BATCH_MIN_INTERVAL_MS
// leaves — slower than a real batch call, but the only way this path
// actually completes instead of failing partway through every time.
const FALLBACK_MIN_INTERVAL_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const batches = chunkArray(texts, BATCH_SIZE);
    const results: number[][] = [];
    for (let i = 0; i < batches.length; i++) {
      // No wait before the first batch — pacing only matters BETWEEN
      // calls; a single-batch document (the common case) is unaffected.
      if (i > 0) await sleep(BATCH_MIN_INTERVAL_MS);
      const vectors = await this.embedBatchWithFallback(batches[i], taskType);
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
          `[embeddings] ${this.model} doesn't appear to support batched embedContent calls — falling back to one paced call per text for this batch of ${texts.length}.`,
        );
        const results: number[][] = [];
        for (const t of texts) {
          const [vector] = await this.embedContentWithRetry([t], taskType);
          results.push(vector);
          await sleep(FALLBACK_MIN_INTERVAL_MS);
        }
        return results;
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
