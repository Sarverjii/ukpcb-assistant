import type { EmbeddingProvider } from '@/lib/embeddings/types';
import { config } from '@/lib/config';

// Free, local, in-process embeddings — no API key, no signup, no external
// service. Runs Xenova/all-MiniLM-L6-v2 (a small, well-regarded sentence
// embedding model, ~90MB quantized, CPU-friendly, 384-dimensional output)
// via @huggingface/transformers' ONNX runtime. Good for dev/testing at the
// ~100-document scale this project starts at; swap EMBEDDING_PROVIDER to
// "openai" later for a hosted alternative without touching any caller of
// getEmbeddingProvider().
type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  // Memoized module-level singleton: the model is loaded once per server
  // process (first request pays the load cost), not once per request.
  extractorPromise ??= import('@huggingface/transformers').then(({ pipeline }) =>
    pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      dtype: 'q8',
    }),
  ) as Promise<FeatureExtractionPipeline>;
  return extractorPromise;
}

export class LocalTransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = config.EMBEDDING_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}
