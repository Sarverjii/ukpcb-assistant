import { config } from '@/lib/config';
import type { LLMProvider } from '@/lib/llm/types';
import { AnthropicLLMProvider } from '@/lib/llm/anthropicProvider';
import { OllamaLLMProvider } from '@/lib/llm/ollamaProvider';
import { GeminiLLMProvider } from '@/lib/llm/geminiProvider';

let provider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (provider) return provider;

  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      provider = new AnthropicLLMProvider();
      break;
    case 'ollama':
      provider = new OllamaLLMProvider();
      break;
    case 'gemini':
      provider = new GeminiLLMProvider();
      break;
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${config.LLM_PROVIDER}`);
  }
  return provider;
}
