import { config } from '@/lib/config';
import type { EmbeddingProvider } from '@/lib/embeddings/types';
import { LocalTransformersEmbeddingProvider } from '@/lib/embeddings/localTransformersProvider';
import { GeminiEmbeddingProvider } from '@/lib/embeddings/geminiEmbeddingProvider';
import { OpenAIEmbeddingProvider } from '@/lib/embeddings/openaiProvider';
import { OllamaEmbeddingProvider } from '@/lib/embeddings/ollamaEmbeddingProvider';
import { getActiveCredential } from '@/lib/db/queries/aiProviders';
import { decryptSecret } from '@/lib/ai/crypto';

/**
 * Swap point #1 of 3 (with LLMProvider and StorageProvider) — now
 * runtime-switchable, not just env-var-configured. Checks the database
 * FIRST for an admin-activated provider (Admin -> AI Models); only when
 * none is active does it fall back to the static EMBEDDING_PROVIDER/*_API_KEY
 * env vars, exactly as this app behaved before that feature existed. See
 * lib/llm/index.ts's matching comment for why there's no caching here
 * either.
 *
 * "local" is deliberately NOT offered as a DB-switchable option in Admin ->
 * AI Models (still reachable via the EMBEDDING_PROVIDER env var, handled
 * below) — Xenova/all-MiniLM-L6-v2 is fixed at 384 dimensions, structurally
 * incompatible with this app's vector(768) column without a schema
 * migration + full re-embed; every provider actually offered in the admin
 * UI (Gemini, OpenAI, Ollama) is asked for exactly EMBEDDING_DIMENSIONS
 * instead, keeping every DB-driven switch schema-safe. Switching embedding
 * providers still doesn't retroactively re-embed already-indexed
 * documents, though — see the admin page's own on-screen warning.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  const active = await getActiveCredential('EMBEDDING');
  if (active) {
    switch (active.provider) {
      case 'GEMINI':
        return new GeminiEmbeddingProvider({
          apiKey: decryptSecret(active.encryptedApiKey!),
          model: active.model || config.EMBEDDING_MODEL,
        });
      case 'OPENAI':
        return new OpenAIEmbeddingProvider({
          apiKey: decryptSecret(active.encryptedApiKey!),
          model: active.model || 'text-embedding-3-small',
        });
      case 'OLLAMA':
        return new OllamaEmbeddingProvider({
          baseUrl: active.baseUrl || config.OLLAMA_BASE_URL,
          model: active.model || 'nomic-embed-text',
        });
      case 'ANTHROPIC':
        // Not offered in Admin -> AI Models — Anthropic has no public
        // embeddings API — but the enum admits it, so this stays an
        // explicit error rather than an unreachable-case type hole.
        throw new Error('Anthropic does not offer an embeddings API.');
    }
  }

  // Fallback: the original, purely env-var-driven behavior.
  switch (config.EMBEDDING_PROVIDER) {
    case 'local':
      return new LocalTransformersEmbeddingProvider();
    case 'gemini':
      if (!config.GEMINI_API_KEY) {
        throw new Error(
          'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey, ' +
            'set EMBEDDING_PROVIDER to "local" instead, or configure a provider from Admin -> AI Models.',
        );
      }
      return new GeminiEmbeddingProvider({ apiKey: config.GEMINI_API_KEY, model: config.EMBEDDING_MODEL });
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        throw new Error(
          'OPENAI_API_KEY is not set. Set EMBEDDING_PROVIDER to "local" or "gemini" instead, ' +
            'or configure a provider from Admin -> AI Models.',
        );
      }
      return new OpenAIEmbeddingProvider({ apiKey: config.OPENAI_API_KEY, model: config.EMBEDDING_MODEL });
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${config.EMBEDDING_PROVIDER}`);
  }
}
