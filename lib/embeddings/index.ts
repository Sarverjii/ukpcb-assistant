import { config } from '@/lib/config';
import type { EmbeddingProvider } from '@/lib/embeddings/types';
import { LocalTransformersEmbeddingProvider } from '@/lib/embeddings/localTransformersProvider';
import { OpenAIEmbeddingProvider } from '@/lib/embeddings/openaiProvider';

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  switch (config.EMBEDDING_PROVIDER) {
    case 'local':
      provider = new LocalTransformersEmbeddingProvider();
      break;
    case 'openai':
      provider = new OpenAIEmbeddingProvider();
      break;
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${config.EMBEDDING_PROVIDER}`);
  }
  return provider;
}
