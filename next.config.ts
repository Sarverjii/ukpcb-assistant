import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @huggingface/transformers ships native ONNX runtime bindings and large
  // WASM assets — let Node require() it directly instead of having
  // Turbopack try to bundle it. (The provider that used it,
  // LocalTransformersEmbeddingProvider, was removed once every embedding
  // provider became DB-configured via Admin -> AI Models — it was already
  // excluded from that UI as dimension-incompatible with this app's
  // vector(768) column, and losing its env var removed its last
  // reachable entry point. This special-casing is left in place in case
  // a future dev-only provider needs the same package again; it's inert
  // otherwise.)
  // pdf-parse (via pdfjs-dist) ships a pdf.worker.mjs file it loads by
  // relative path at runtime — Turbopack bundling it moved/omitted that
  // file, breaking every PDF upload with "Setting up fake worker failed:
  // Cannot find module '.../pdf.worker.mjs'". Found this by actually
  // uploading real PDFs at volume (all 20/20 in the test batch failed
  // identically), not by anticipating it — same fix as transformers above.
  // @napi-rs/canvas (used by lib/documents/pdfRasterize.ts, for scanned-
  // document OCR) ships a native .node addon selected at runtime by
  // platform via js-binding.js's own require() calls — Turbopack can't
  // place a native addon inside an ESM chunk at all ("non-ecmascript
  // placeable asset"), the same fundamental issue as onnxruntime-node
  // below, just caught at build time instead of only in production.
  serverExternalPackages: ['@huggingface/transformers', 'pdf-parse', '@napi-rs/canvas'],
  // Vercel's build only deploys the files its file-tracer (@vercel/nft)
  // can statically determine a route actually needs — not the full
  // node_modules tree. onnxruntime-node's native addon selects its
  // platform binary (libonnxruntime.so.1) at runtime by process.platform/
  // arch, which nft's static import/require analysis can't see, so it got
  // silently dropped from the deployed bundle: every document upload in
  // production failed with "libonnxruntime.so.1: cannot open shared object
  // file" — confirmed directly from the deployed app's own audit log, not
  // anticipated. This forces those specific files back in. Deliberately
  // NOT the whole onnxruntime-node/bin tree (513MB across every platform,
  // including 315MB of CUDA/TensorRT provider libraries irrelevant on
  // Vercel's CPU-only functions) — just the ~35MB linux/x64 CPU runtime
  // this app actually uses.
  // Same story, different file: pdf-parse (via pdfjs-dist) loads its worker
  // script by relative path at runtime rather than a statically-analyzable
  // import, so nft misses it too — confirmed directly, every PDF upload in
  // production failed with "Setting up fake worker failed: Cannot find
  // module '.../pdf.worker.mjs'" even after the onnxruntime fix above.
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_shared.so',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/build/pdf.worker.mjs',
    ],
  },
  // Hides the dev-only route indicator badge (bottom-left by default).
  // Next.js still surfaces compile/runtime errors without it.
  devIndicators: false,
  experimental: {
    // Proxy buffers request bodies to a default 10MB cap — separate from,
    // and silently smaller than, our own UPLOAD_MAX_MB (100MB) application
    // check in app/api/documents/upload/route.ts. Above the cap the proxy
    // truncates the body rather than erroring, which corrupts the
    // multipart form and surfaces as a confusing generic 500 instead of a
    // clean "file too large" message — found by actually uploading a
    // 12MB file, not by reading the docs first. Only matters for the local
    // single-request upload route (`next dev`/`local` storage) — production
    // on Vercel uses the client-direct-to-Blob flow instead, which never
    // routes the file through this proxy at all. Set comfortably above
    // UPLOAD_MAX_MB to leave room for multipart boundary/field overhead.
    proxyClientMaxBodySize: '110mb',
  },
};

export default nextConfig;
