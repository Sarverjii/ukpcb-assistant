import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Route every DB call in the test run at the disposable test database, never
// the dev database seeded with real-looking data — see .env.example.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// LLM/embedding provider selection has no env-var fallback in the app
// itself (see lib/llm/index.ts / lib/embeddings/index.ts) — it's entirely
// DB-driven via Admin -> AI Models. For the test suite to run standalone
// (without needing to drive that admin UI first), this auto-provisions a
// real, working Gemini provider directly into the test database whenever
// GEMINI_API_KEY is present in the environment — the SAME mechanism a real
// admin uses (save + activate a AIProviderCredential row), just done here
// once before any test runs, using a real model id discovered live from
// Gemini's own API (not a hardcoded guess — model names change). Silently
// does nothing if the key is absent; the DB-layer security tests don't
// need a real provider at all, and the tests that do are already gated
// with `it.runIf(...)` and skip cleanly.
if (process.env.GEMINI_API_KEY) {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { encryptSecret } = await import('../lib/ai/crypto');
  const { listModelsForProvider } = await import('../lib/ai/modelDiscovery');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const [llmModels, embeddingModels] = await Promise.all([
      listModelsForProvider('GEMINI', 'LLM', { apiKey }),
      listModelsForProvider('GEMINI', 'EMBEDDING', { apiKey }),
    ]);
    // Gemini's own models.list() keeps listing versioned model ids
    // (e.g. gemini-2.5-flash-lite) long after they 404 on an actual
    // generateContent call for new API keys — a real quirk of that API,
    // observed directly against production. The "-latest" alias ids
    // (e.g. gemini-flash-lite-latest) are what Google itself keeps
    // pointed at a currently-working model, so prefer one of those over
    // a versioned id when both are available.
    const llmModel =
      llmModels.find((m) => /flash-lite-latest/i.test(m.id)) ??
      llmModels.find((m) => /flash-lite/i.test(m.id)) ??
      llmModels[0];
    const embeddingModel = embeddingModels[0];

    for (const [capability, model] of [
      ['LLM', llmModel.id],
      ['EMBEDDING', embeddingModel.id],
    ] as const) {
      await prisma.aIProviderCredential.upsert({
        where: { capability_provider: { capability, provider: 'GEMINI' } },
        create: { capability, provider: 'GEMINI', encryptedApiKey: encryptSecret(apiKey), model, isActive: true },
        update: { encryptedApiKey: encryptSecret(apiKey), model, isActive: true },
      });
    }
  } catch (err) {
    console.warn('[tests/setup] Could not auto-provision a Gemini provider for the test DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}
