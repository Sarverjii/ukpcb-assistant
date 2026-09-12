import { z } from 'zod';

// Single source of truth for env vars. Parsed once at import time so a
// missing/malformed value fails fast at startup instead of surfacing as a
// runtime error mid-request. This is also where the provider-selection env
// var for storage lives (STORAGE_PROVIDER) — the swap point for
// lib/documents/storage. LLM/embedding provider selection is NOT here: by
// explicit design, there is no env-var fallback for either — both are
// entirely DB-driven via Admin -> AI Models (see lib/llm/index.ts and
// lib/embeddings/index.ts). The only AI-related env vars left are
// EMBEDDING_DIMENSIONS (a structural constant — the fixed vector(N) column
// width, not a per-provider credential) and AI_CREDENTIALS_ENCRYPTION_KEY
// (the key that encrypts saved credentials, which by design must live
// outside the database that stores them).
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(1),

  // The fixed vector(N) column width every embedding provider configured
  // via Admin -> AI Models is asked to honor (Gemini/OpenAI both support
  // requesting this exact size; Ollama's chosen model must natively
  // produce it — see lib/embeddings/ollamaEmbeddingProvider.ts). Changing
  // this requires a schema migration and re-embedding every existing
  // chunk; it is not something to tune per-provider.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),

  // "local" (disk) only works on a host with a persistent, shared
  // filesystem — not Vercel, whose serverless functions don't have one.
  // "vercel-blob" needs BLOB_READ_WRITE_TOKEN, which Vercel injects
  // automatically once a Blob store is created and linked to the project.
  STORAGE_PROVIDER: z.enum(['local', 'vercel-blob']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage/documents'),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(100),
  // The @vercel/blob SDK's plain put()/get()/head() calls pick this up from
  // process.env implicitly and reliably. Its handleUpload() helper (used
  // for the client-direct-upload token flow — see
  // app/api/documents/blob-upload-token/route.ts) does NOT reliably do the
  // same in practice — confirmed directly in production: a real token
  // request failed with "No read-write token found" even though the exact
  // same deployment's storage.save()/read() calls were already working.
  // Read explicitly here and passed to handleUpload({ token }) rather than
  // relying on its implicit default.
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // Encrypts every API key an admin saves via Admin → AI Models (see
  // lib/ai/crypto.ts) — AES-256-GCM, base64-encoded, must decode to exactly
  // 32 bytes. Deliberately NOT stored in the database itself: the whole
  // point of encrypting a saved key is that reading the database alone
  // (a backup, a leaked connection string) isn't enough to recover it —
  // this key has to live somewhere separate, i.e. here, in the platform's
  // own env var store. Optional at the config level so a deployment that
  // never touches the AI Models admin page doesn't need it; lib/ai/crypto.ts
  // throws a clear, actionable error the moment it's actually needed
  // without being set, rather than failing at startup for everyone.
  AI_CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
});

// Vercel's own env var UI does NOT treat "leave the value blank" as "don't
// set this variable" — a variable listed with an empty value still reaches
// process.env as the literal empty string "", not undefined. That silently
// broke every optional/defaulted field above: z.coerce.number() coerces ""
// to 0 (JS's own Number("") === 0), which then fails .positive() with a
// confusing "Too small: expected number to be >0" — confirmed directly,
// this is exactly what happened deploying this project to Vercel the first
// time, on EMBEDDING_DIMENSIONS and UPLOAD_MAX_MB both, deleting neither
// var (as Vercel's UI made it look required, since it was pre-listed from
// .env.example) fixed it, just leaving their values blank. Normalizing
// every blank env var to undefined here, once, before the schema ever sees
// it, means "" and "genuinely absent" are indistinguishable from this
// point on — so `.default(...)` and `.optional()` behave the same
// regardless of which one a given deployment platform's UI actually does.
function blankToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value === '' ? undefined : value;
  }
  return out;
}

export const config = envSchema.parse(blankToUndefined(process.env));
