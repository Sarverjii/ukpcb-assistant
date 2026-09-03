import type { EmbeddingProvider } from '@/lib/embeddings/types';
import { GeminiEmbeddingProvider } from '@/lib/embeddings/geminiEmbeddingProvider';
import { OpenAIEmbeddingProvider } from '@/lib/embeddings/openaiProvider';
import { OllamaEmbeddingProvider } from '@/lib/embeddings/ollamaEmbeddingProvider';
import { getActiveCredential } from '@/lib/db/queries/aiProviders';
import { decryptSecret } from '@/lib/ai/crypto';
import { NoActiveProviderError } from '@/lib/ai/errors';

/**
 * Swap point #1 of 3 (with LLMProvider and StorageProvider) — entirely
 * DB-driven, by explicit request: there is deliberately NO env-var fallback
 * (EMBEDDING_PROVIDER/GEMINI_API_KEY/etc. no longer exist in
 * lib/config.ts at all — only EMBEDDING_DIMENSIONS remains, the fixed
 * vector(N) column width every provider is asked to honor). An admin must
 * configure and activate a real provider from Admin -> AI Models before
 * this can succeed — see NoActiveProviderError, which every caller that
 * needs a friendly message catches specifically. See lib/llm/index.ts's
 * matching comment for why there's no caching here either.
 *
 * "local" (the free, in-process Xenova/all-MiniLM-L6-v2 model) is no
 * longer reachable at all — it was already excluded from the DB-switchable
 * admin UI (fixed at 384 dimensions, incompatible with this column), and
 * removing its env var removed its last entry point too.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  const active = await getActiveCredential('EMBEDDING');
  if (!active || !active.model) throw new NoActiveProviderError('EMBEDDING');

  switch (active.provider) {
    case 'GEMINI':
      return new GeminiEmbeddingProvider({ apiKey: decryptSecret(active.encryptedApiKey!), model: active.model });
    case 'OPENAI':
      return new OpenAIEmbeddingProvider({ apiKey: decryptSecret(active.encryptedApiKey!), model: active.model });
    case 'OLLAMA':
      return new OllamaEmbeddingProvider({ baseUrl: active.baseUrl || 'http://localhost:11434', model: active.model });
    case 'ANTHROPIC':
      // Not offered in Admin -> AI Models — Anthropic has no public
      // embeddings API — but the enum admits it, so this stays an
      // explicit error rather than an unreachable-case type hole.
      throw new Error('Anthropic does not offer an embeddings API.');
  }
}
