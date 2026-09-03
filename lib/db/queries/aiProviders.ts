import { prisma } from '@/lib/db/prisma';
import type { AICapability, AIProviderKind } from '@prisma/client';
import { encryptSecret } from '@/lib/ai/crypto';

/** Providers that need a real API key to function — Ollama is the one exception (self-hosted, no key). */
export const PROVIDERS_REQUIRING_API_KEY = new Set<AIProviderKind>(['ANTHROPIC', 'GEMINI', 'OPENAI']);

export type ProviderCredentialSummary = {
  capability: AICapability;
  provider: AIProviderKind;
  isConfigured: boolean;
  baseUrl: string | null;
  model: string | null;
  isActive: boolean;
  updatedAt: Date;
  updatedByName: string | null;
};

/**
 * Everything the Admin -> AI Models page needs to render — deliberately
 * NEVER selects encryptedApiKey. `isConfigured` is computed here, from a
 * value that is fetched and immediately discarded, so the raw or encrypted
 * key can never accidentally flow into a client-facing result even by a
 * future careless edit to this file (there's no field left to leak by the
 * time this function returns).
 */
export async function listProviderCredentialsSummary(): Promise<ProviderCredentialSummary[]> {
  const rows = await prisma.aIProviderCredential.findMany({
    include: { updatedBy: { select: { name: true } } },
    orderBy: [{ capability: 'asc' }, { provider: 'asc' }],
  });
  return rows.map((r) => ({
    capability: r.capability,
    provider: r.provider,
    isConfigured: r.encryptedApiKey !== null || r.provider === 'OLLAMA',
    baseUrl: r.baseUrl,
    model: r.model,
    isActive: r.isActive,
    updatedAt: r.updatedAt,
    updatedByName: r.updatedBy?.name ?? null,
  }));
}

/**
 * SERVER-ONLY — the decrypted-at-the-last-possible-moment credential for
 * whichever provider is currently active for a capability. Called
 * exclusively from lib/llm/index.ts and lib/embeddings/index.ts to
 * construct a provider client; its result must never be returned from a
 * server action or otherwise reach a client component. Returns null if no
 * provider is active for this capability — the caller falls back to the
 * static env-var configuration in that case.
 */
export function getActiveCredential(capability: AICapability) {
  return prisma.aIProviderCredential.findFirst({
    where: { capability, isActive: true },
  });
}

/**
 * Upserts one (capability, provider) row. `apiKey` is write-only and
 * optional on purpose: omitting it (undefined) leaves whatever key is
 * already saved untouched — an admin can update just the model override or
 * base URL without re-pasting a key every time. Passing an empty string
 * explicitly is treated as "no key" (clears it), distinct from omitting
 * the field entirely.
 */
export async function saveProviderCredential(input: {
  capability: AICapability;
  provider: AIProviderKind;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  updatedById: string;
}): Promise<void> {
  const encryptedApiKey = input.apiKey === undefined ? undefined : input.apiKey === '' ? null : encryptSecret(input.apiKey);

  await prisma.aIProviderCredential.upsert({
    where: { capability_provider: { capability: input.capability, provider: input.provider } },
    create: {
      capability: input.capability,
      provider: input.provider,
      encryptedApiKey: encryptedApiKey ?? null,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      updatedById: input.updatedById,
    },
    update: {
      ...(encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      updatedById: input.updatedById,
    },
  });
}

/**
 * Makes `provider` the active one for `capability`, deactivating every
 * other provider of that same capability in the same transaction — at
 * most one active row per capability is the invariant the provider
 * factories rely on. Throws if the target has no saved credentials yet
 * (for a provider that needs a key) rather than silently activating a
 * provider that can't actually serve a request.
 */
export async function setActiveProvider(input: {
  capability: AICapability;
  provider: AIProviderKind;
  updatedById: string;
}): Promise<void> {
  const target = await prisma.aIProviderCredential.findUnique({
    where: { capability_provider: { capability: input.capability, provider: input.provider } },
  });
  if (!target) {
    throw new Error('Save credentials for this provider before activating it.');
  }
  if (PROVIDERS_REQUIRING_API_KEY.has(input.provider) && !target.encryptedApiKey) {
    throw new Error('This provider needs an API key — save one before activating it.');
  }

  await prisma.$transaction([
    prisma.aIProviderCredential.updateMany({
      where: { capability: input.capability, isActive: true },
      data: { isActive: false },
    }),
    prisma.aIProviderCredential.update({
      where: { capability_provider: { capability: input.capability, provider: input.provider } },
      data: { isActive: true, updatedById: input.updatedById },
    }),
  ]);
}

/** Clears the active flag for a capability entirely — reverts to the env-var fallback. */
export async function deactivateCapability(capability: AICapability): Promise<void> {
  await prisma.aIProviderCredential.updateMany({
    where: { capability, isActive: true },
    data: { isActive: false },
  });
}
