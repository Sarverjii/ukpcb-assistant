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
  // device: 'wasm' would avoid the native ONNX runtime addon entirely, but
  // @huggingface/transformers' Node-targeted build only accepts cuda/webgpu/
  // cpu for `device` (confirmed directly — 'wasm' throws "Unsupported
  // device"); the WASM backend is only reachable from its browser build.
  // 'cpu' (the default, left unset here) is the only real option in Node,
  // which needs the native onnxruntime-node addon — see next.config.ts's
  // outputFileTracingIncludes for why that addon actually reaches Vercel's
  // serverless bundle instead of failing with a missing .so file.
  extractorPromise ??= import('@huggingface/transformers').then(({ pipeline, env }) => {
    // Defaults to caching downloaded model files at ./.cache, resolved
    // relative to the package itself — inside node_modules, which is part
    // of Vercel's deployed bundle and READ-ONLY at runtime. Confirmed
    // directly in production: "ENOENT: no such file or directory, mkdir
    // '/var/task/node_modules/@huggingface/transformers/.cache'". /tmp is
    // the one writable directory in Vercel's serverless functions — model
    // files land there instead. /tmp is wiped between cold starts (not
    // warm/repeat invocations of the same instance), so a cold start may
    // re-download the ~90MB quantized model from Hugging Face; that's a
    // one-time latency cost per cold instance, not a correctness issue.
    env.cacheDir = '/tmp/transformers-cache';
    return pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      dtype: 'q8',
    });
  }) as Promise<FeatureExtractionPipeline>;
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
