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
// Reuses GEMINI_API_KEY (already required for chat) — no new signup.

// Batching keeps request count down (Gemini's free-tier rate limits are
// per-request, not per-text) without risking an oversized single payload.
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
// 429 rate-limited, 500 internal error, 503 "currently experiencing high
// demand" — all transient, worth a short backoff-and-retry rather than
// failing the whole batch over one blip.
const RETRYABLE_STATUS = new Set([429, 500, 503]);

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!config.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey, ' +
        'or set EMBEDDING_PROVIDER to "local" instead.',
    );
  }
  client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function embedContentWithRetry(
  texts: string[],
  taskType: EmbeddingTaskType,
  attempt = 0,
): Promise<number[][]> {
  try {
    const response = await getClient().models.embedContent({
      model: config.EMBEDDING_MODEL,
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
      return embedContentWithRetry(texts, taskType, attempt + 1);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = config.EMBEDDING_DIMENSIONS;

  async embed(texts: string[], taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT'): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (const batch of chunkArray(texts, BATCH_SIZE)) {
      const vectors = await embedContentWithRetry(batch, taskType);
      results.push(...vectors);
    }
    return results;
  }
}
