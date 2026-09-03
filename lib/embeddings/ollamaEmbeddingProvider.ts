import { config } from '@/lib/config';
import type { EmbeddingProvider } from '@/lib/embeddings/types';

// Free, local, no API key — embeddings via a locally-running Ollama server,
// same server the chat-side OllamaLLMProvider talks to. Uses Ollama's
// batch-capable `/api/embed` endpoint (not the older single-prompt
// `/api/embeddings`).
//
// IMPORTANT: unlike Gemini/OpenAI, Ollama has no "give me exactly N
// dimensions" parameter — the pulled model's native output size is
// whatever it is. This app's vector(N) column is fixed at
// EMBEDDING_DIMENSIONS (768 by default), so the chosen Ollama embedding
// model MUST natively produce that many dimensions or every embed() call
// fails loudly (see the check below) rather than silently corrupting the
// column. `nomic-embed-text` conveniently produces 768-dimensional vectors
// by default — the recommended pull for this app: `ollama pull
// nomic-embed-text`. A model with a different native size (e.g.
// mxbai-embed-large at 1024) needs EMBEDDING_DIMENSIONS changed to match,
// which is a real schema migration + re-embed of every existing chunk, not
// a config-only change.
//
// Doesn't work at all on the current Vercel deployment (no persistent
// local network to reach a self-hosted server from) — wired up and
// selectable in Admin -> AI Models regardless, ready for the day this app
// moves to a self-hosted Linux/nginx deployment. Constructed fresh by
// lib/embeddings/index.ts on every getEmbeddingProvider() call with
// whichever credentials are currently active (DB-configured, or
// OLLAMA_BASE_URL/EMBEDDING_MODEL as a fallback).
const BATCH_SIZE = 50;

type OllamaEmbedResponse = {
  embeddings?: number[][];
  error?: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = config.EMBEDDING_DIMENSIONS;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: { baseUrl: string; model: string }) {
    this.baseUrl = options.baseUrl;
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
      res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? ` +
          `Start it with \`ollama serve\`, and make sure \`ollama pull ${this.model}\` has been run at least once.`,
      );
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    if (!res.ok || data.error || !data.embeddings) {
      throw new Error(
        `Ollama error: ${data.error ?? res.statusText}. If the model isn't pulled yet, run ` +
          `\`ollama pull ${this.model}\`.`,
      );
    }
    if (data.embeddings.length !== texts.length) {
      throw new Error(
        `Embedding batch size mismatch: sent ${texts.length} texts, got ${data.embeddings.length} embeddings back.`,
      );
    }

    return data.embeddings.map((values, i) => {
      if (values.length !== config.EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding dimension mismatch at index ${i}: model "${this.model}" produced ${values.length}-dimensional ` +
            `vectors, but this app's vector column is fixed at ${config.EMBEDDING_DIMENSIONS} ` +
            '(EMBEDDING_DIMENSIONS). Ollama has no truncation option, unlike Gemini/OpenAI — pull ' +
            '"nomic-embed-text" (768-dimensional) instead, or change EMBEDDING_DIMENSIONS and ' +
            're-embed every existing document.',
        );
      }
      return values;
    });
  }
}
