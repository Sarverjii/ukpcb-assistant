import { z } from 'zod';

// Single source of truth for env vars. Parsed once at import time so a
// missing/malformed value fails fast at startup instead of surfacing as a
// runtime error mid-request. This is also where the provider-selection env
// vars live (LLM_PROVIDER / EMBEDDING_PROVIDER / STORAGE_PROVIDER) — the
// swap point for the provider abstractions in lib/llm, lib/embeddings, and
// lib/documents/storage.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(1),

  // "gemini" (Google's genuinely-free API tier, no local compute needed —
  // works both in local dev and on tiny free hosting tiers like Render's)
  // is the default. "ollama" is free too but needs a local/self-hosted
  // model server, so it can't run on most free web-hosting tiers. Switch to
  // "anthropic" for Claude when you're ready to pay for hosted inference.
  LLM_PROVIDER: z.enum(['anthropic', 'ollama', 'gemini']).default('gemini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),
  GEMINI_API_KEY: z.string().optional(),
  // Both gemini-2.5-flash and gemini-2.5-flash-lite are retired (404 for new
  // users) — verified live. Their suggested replacement, gemini-3.6-flash
  // (the full "Flash" tier, not "Flash-Lite"), turned out to carry only a
  // 20-requests/day free quota for this project (confirmed from the actual
  // 429 response body, not documentation — published free-tier numbers for
  // this model generation were already stale). "Flash-Lite" is Google's
  // higher-quota free tier, and "-latest" is Google's own maintained alias
  // for whichever concrete Flash-Lite model is current — deliberately not
  // pinning a dated version name here, since that's exactly what broke
  // twice already this session.
  GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),
  // Tried only after GEMINI_MODEL 503s and its own retries are exhausted —
  // see geminiProvider.ts. Exists because gemini-flash-latest is a
  // genuinely stronger ("thinking") model than flash-lite and free on the
  // same tier, but its free-tier capacity has measurably been unavailable
  // for stretches at a time (confirmed via repeated direct 503 "high
  // demand" responses, not assumed): set GEMINI_MODEL to the stronger model
  // and this to "gemini-flash-lite-latest" to get the better model whenever
  // it's actually up, without a request ever failing outright because of
  // it. Leave unset to disable the fallback (a 503 just fails the request).
  GEMINI_FALLBACK_MODEL: z.string().optional(),

  EMBEDDING_PROVIDER: z.enum(['local', 'openai']).default('local'),
  EMBEDDING_MODEL: z.string().default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(384),
  OPENAI_API_KEY: z.string().optional(),

  // "local" (disk) only works on a host with a persistent, shared
  // filesystem — not Vercel, whose serverless functions don't have one.
  // "vercel-blob" needs BLOB_READ_WRITE_TOKEN, which Vercel injects
  // automatically once a Blob store is created and linked to the project.
  STORAGE_PROVIDER: z.enum(['local', 'vercel-blob']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/documents'),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
});

export const config = envSchema.parse(process.env);
