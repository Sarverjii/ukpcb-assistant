import type { LLMProvider } from '@/lib/llm/types';
import { AnthropicLLMProvider } from '@/lib/llm/anthropicProvider';
import { OllamaLLMProvider } from '@/lib/llm/ollamaProvider';
import { GeminiLLMProvider } from '@/lib/llm/geminiProvider';
import { OpenAILLMProvider } from '@/lib/llm/openaiProvider';
import { getActiveCredential } from '@/lib/db/queries/aiProviders';
import { decryptSecret } from '@/lib/ai/crypto';
import { NoActiveProviderError } from '@/lib/ai/errors';

/**
 * Swap point #2 of 3 (with EmbeddingProvider and StorageProvider) —
 * entirely DB-driven, by explicit request: there is deliberately NO env-var
 * fallback (LLM_PROVIDER/ANTHROPIC_API_KEY/etc. no longer exist in
 * lib/config.ts at all). An admin must configure and activate a real
 * provider from Admin -> AI Models before this can succeed — see
 * NoActiveProviderError, which every caller that needs a friendly message
 * (the chat pages' banner, the chat stream route) catches specifically. No
 * caching: a fresh DB read and a fresh provider instance every call,
 * matching this codebase's established "always re-verify from the DB,
 * never trust a cached value" philosophy (see getAuthContext()) — an admin
 * switching providers takes effect on the very next request.
 */
export async function getLLMProvider(): Promise<LLMProvider> {
  const active = await getActiveCredential('LLM');
  if (!active || !active.model) throw new NoActiveProviderError('LLM');

  switch (active.provider) {
    case 'ANTHROPIC':
      return new AnthropicLLMProvider({ apiKey: decryptSecret(active.encryptedApiKey!), model: active.model });
    case 'GEMINI':
      return new GeminiLLMProvider({ apiKey: decryptSecret(active.encryptedApiKey!), model: active.model });
    case 'OPENAI':
      return new OpenAILLMProvider({ apiKey: decryptSecret(active.encryptedApiKey!), model: active.model });
    case 'OLLAMA':
      return new OllamaLLMProvider({ baseUrl: active.baseUrl || 'http://localhost:11434', model: active.model });
  }
}
