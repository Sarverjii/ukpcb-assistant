'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { requireAdminReauth } from '@/lib/auth/reauth';
import { logAuditEvent } from '@/lib/audit/log';
import {
  saveProviderCredential,
  setActiveProvider,
  deactivateCapability,
} from '@/lib/db/queries/aiProviders';
import type { AICapability, AIProviderKind } from '@prisma/client';

export type ActionResult = { error?: string };

/**
 * Save-and-activate in one step, gated behind admin re-auth — the same
 * tier as resetting a password or bulk-importing employees (see
 * requireAdminReauth's own doc comment): this saves a real credential and
 * immediately makes it live for every future request, the highest-stakes
 * action in this admin surface. `apiKey` is optional: leaving it blank
 * when a key was already saved for this provider keeps the existing one
 * (see saveProviderCredential) — useful for updating just a model override
 * without re-pasting a working key.
 */
export async function saveAndActivateProviderAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const capability = String(formData.get('capability') ?? '') as AICapability;
  const provider = String(formData.get('provider') ?? '') as AIProviderKind;
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  const baseUrl = String(formData.get('baseUrl') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!capability || !provider) return { error: 'Missing capability or provider.' };

  try {
    await requireAdminReauth(ctx, password, `aiProviders:save:${capability}:${provider}`);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  try {
    await saveProviderCredential({
      capability,
      provider,
      apiKey: apiKey ? apiKey : undefined,
      baseUrl: baseUrl ? baseUrl : provider === 'OLLAMA' ? null : undefined,
      model: model ? model : null,
      updatedById: ctx.userId,
    });
    await setActiveProvider({ capability, provider, updatedById: ctx.userId });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save.' };
  }

  await logAuditEvent({
    action: 'AI_PROVIDER_ACTIVATED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: `${capability}:${provider}`,
    metadata: { capability, provider, modelOverride: model || null },
  });

  revalidatePath('/admin/ai-providers');
  return {};
}

/**
 * Reverts a capability back to its env-var fallback (LLM_PROVIDER /
 * EMBEDDING_PROVIDER in lib/config.ts) without deleting any saved
 * credential — a provider's key stays on file, just inactive, so
 * re-activating it later needs no re-entry.
 */
export async function deactivateProviderAction(capability: AICapability): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  await deactivateCapability(capability);
  await logAuditEvent({
    action: 'AI_PROVIDER_DEACTIVATED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: capability,
    metadata: { capability },
  });

  revalidatePath('/admin/ai-providers');
  return {};
}
