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
  getDecryptedCredentialForRefresh,
} from '@/lib/db/queries/aiProviders';
import { listModelsForProvider, type DiscoveredModel } from '@/lib/ai/modelDiscovery';
import type { AICapability, AIProviderKind } from '@prisma/client';

export type ActionResult = { error?: string };
export type FetchModelsResult = { models?: DiscoveredModel[]; error?: string };

/**
 * Lists a provider's REAL, currently-available models using whatever
 * key/base URL is passed in — not yet saved anywhere. This is both the
 * model picker's data source AND the "is this key valid" check: a bad key
 * fails to list anything. Read-only (no reauth) — nothing is persisted
 * here, so it doesn't need the same gate as actually saving a credential.
 */
export async function fetchModelsAction(
  capability: AICapability,
  provider: AIProviderKind,
  apiKey: string,
  baseUrl: string,
): Promise<FetchModelsResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  try {
    const models = await listModelsForProvider(provider, capability, {
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    });
    return { models };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not list models.' };
  }
}

/**
 * Re-validates whichever provider is CURRENTLY SAVED for a capability,
 * using the key already on file (never re-exposed to the client) — the
 * "Refresh" button on an active/configured provider, confirming the saved
 * key still works and pulling the current live model list again without
 * anyone re-pasting it. Read-only, same as fetchModelsAction.
 */
export async function refreshModelsAction(capability: AICapability, provider: AIProviderKind): Promise<FetchModelsResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const saved = await getDecryptedCredentialForRefresh(capability, provider);
  if (!saved) return { error: 'No credentials saved yet for this provider.' };

  try {
    const models = await listModelsForProvider(provider, capability, {
      apiKey: saved.apiKey,
      baseUrl: saved.baseUrl ?? undefined,
    });
    return { models };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not list models.' };
  }
}

/**
 * Save-and-activate in one step, gated behind admin re-auth — the same
 * tier as resetting a password or bulk-importing employees (see
 * requireAdminReauth's own doc comment): this saves a real credential and
 * immediately makes it live for every future request, the highest-stakes
 * action in this admin surface.
 *
 * Validates FIRST, by actually listing this provider's live models with
 * the submitted key (or, if `apiKey` is blank, the key already saved for
 * this provider — lets an admin change just the chosen model without
 * re-pasting a working key) — activation only proceeds if that succeeds
 * AND the chosen model is actually in the returned list. A key that
 * doesn't work is never saved at all, per the explicit requirement that
 * this only ever changes on a valid, working key.
 */
export async function saveAndActivateProviderAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  const capability = String(formData.get('capability') ?? '') as AICapability;
  const provider = String(formData.get('provider') ?? '') as AIProviderKind;
  const apiKeyInput = String(formData.get('apiKey') ?? '').trim();
  const baseUrl = String(formData.get('baseUrl') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!capability || !provider) return { error: 'Missing capability or provider.' };
  if (!model) return { error: 'Choose a model.' };

  try {
    await requireAdminReauth(ctx, password, `aiProviders:save:${capability}:${provider}`);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  let apiKeyToValidate = apiKeyInput || undefined;
  if (!apiKeyToValidate) {
    const saved = await getDecryptedCredentialForRefresh(capability, provider);
    apiKeyToValidate = saved?.apiKey;
  }

  let validatedModels: DiscoveredModel[];
  try {
    validatedModels = await listModelsForProvider(provider, capability, {
      apiKey: apiKeyToValidate,
      baseUrl: baseUrl || undefined,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not validate this provider.' };
  }
  if (!validatedModels.some((m) => m.id === model)) {
    return { error: `"${model}" was not in the list of models this key can actually access. Fetch models again and pick one from the list.` };
  }

  try {
    await saveProviderCredential({
      capability,
      provider,
      apiKey: apiKeyInput ? apiKeyInput : undefined,
      baseUrl: baseUrl ? baseUrl : provider === 'OLLAMA' ? null : undefined,
      model,
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
    metadata: { capability, provider, model },
  });

  revalidatePath('/admin/ai-providers');
  revalidatePath('/chat');
  return {};
}

/**
 * Reverts a capability back to having no active provider — genuinely
 * takes that capability offline for every user (see deactivateCapability's
 * own comment) — without deleting any saved credential, so re-activating
 * later needs no re-entry.
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
  revalidatePath('/chat');
  return {};
}
