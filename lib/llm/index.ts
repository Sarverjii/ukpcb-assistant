import { config } from '@/lib/config';
import type { LLMProvider } from '@/lib/llm/types';
import { AnthropicLLMProvider } from '@/lib/llm/anthropicProvider';
import { OllamaLLMProvider } from '@/lib/llm/ollamaProvider';
import { GeminiLLMProvider } from '@/lib/llm/geminiProvider';
import { getActiveCredential } from '@/lib/db/queries/aiProviders';
import { decryptSecret } from '@/lib/ai/crypto';

/**
 * Swap point #2 of 3 (with EmbeddingProvider and StorageProvider) — now
 * runtime-switchable, not just env-var-configured. Checks the database
 * FIRST for an admin-activated provider (Admin -> AI Models); only when
 * none is active does it fall back to the static LLM_PROVIDER/*_API_KEY
 * env vars, exactly as this app behaved before that feature existed. No
 * caching: a fresh DB read and a fresh provider instance every call,
 * matching this codebase's established "always re-verify from the DB,
 * never trust a cached value" philosophy (see getAuthContext()) — an admin
 * switching providers takes effect on the very next request, no redeploy,
 * no server restart.
 */
export async function getLLMProvider(): Promise<LLMProvider> {
  const active = await getActiveCredential('LLM');
  if (active) {
    switch (active.provider) {
      case 'ANTHROPIC':
        return new AnthropicLLMProvider({
          apiKey: decryptSecret(active.encryptedApiKey!),
          model: active.model || config.ANTHROPIC_MODEL,
        });
      case 'GEMINI':
        return new GeminiLLMProvider({
          apiKey: decryptSecret(active.encryptedApiKey!),
          model: active.model || config.GEMINI_MODEL,
          fallbackModel: config.GEMINI_FALLBACK_MODEL,
        });
      case 'OLLAMA':
        return new OllamaLLMProvider({
          baseUrl: active.baseUrl || config.OLLAMA_BASE_URL,
          model: active.model || config.OLLAMA_MODEL,
        });
      case 'OPENAI':
        // Not offered as an LLM (chat) option in Admin -> AI Models today
        // — OpenAI is only wired up for embeddings — but the enum admits
        // it, so this stays an explicit, clear error rather than an
        // unreachable-case type hole.
        throw new Error('OpenAI is not available as a chat/query provider yet — only for embeddings.');
    }
  }

  // Fallback: the original, purely env-var-driven behavior.
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set. Set LLM_PROVIDER=ollama to use the free local model instead, ' +
            'add a real Anthropic API key, or configure a provider from Admin -> AI Models.',
        );
      }
      return new AnthropicLLMProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL });
    case 'ollama':
      return new OllamaLLMProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.OLLAMA_MODEL });
    case 'gemini':
      if (!config.GEMINI_API_KEY) {
        throw new Error(
          'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey, ' +
            'set LLM_PROVIDER to "ollama" or "anthropic" instead, or configure a provider from Admin -> AI Models.',
        );
      }
      return new GeminiLLMProvider({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
        fallbackModel: config.GEMINI_FALLBACK_MODEL,
      });
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.LLM_PROVIDER}`);
  }
}
