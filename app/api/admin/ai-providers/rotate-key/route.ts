import { NextResponse } from 'next/server';
import { getAuthContext, UnauthenticatedError } from '@/lib/auth/session';
import { requireAdmin, ForbiddenError } from '@/lib/auth/rbac';
import { requireAdminReauth } from '@/lib/auth/reauth';
import { getActiveCredential, saveProviderCredential, setActiveProvider } from '@/lib/db/queries/aiProviders';
import { listModelsForProvider } from '@/lib/ai/modelDiscovery';
import { logAuditEvent } from '@/lib/audit/log';
import type { AICapability } from '@prisma/client';

// REST counterpart to saveAndActivateProviderAction
// (app/(app)/admin/ai-providers/actions.ts), narrowed to exactly the one
// operation external tooling actually needs: "swap the API key for
// whichever provider is already active, keep everything else (provider
// kind, model, base URL) unchanged." Built specifically for Large
// Database/upload-documents.mjs's GUI mode — when a bulk-upload run hits
// the provider's rate/usage limit partway through, prompting the operator
// for a fresh key and activating it here (rather than making them switch
// to a browser mid-run) is what actually lets the run resume unattended.
// Same validate-before-save contract as the UI action: a key that can't
// actually list the currently-configured model is never saved.
export const maxDuration = 60;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getAuthContext();
    await requireAdmin(ctx);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const body = await request.json().catch(() => null);
  const capability = body?.capability;
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (capability !== 'LLM' && capability !== 'EMBEDDING') {
    return NextResponse.json({ error: 'capability must be "LLM" or "EMBEDDING".' }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required.' }, { status: 400 });
  }

  try {
    await requireAdminReauth(ctx, password, `aiProviders:rotateKey:${capability}`);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const activeCapability = capability as AICapability;
  const active = await getActiveCredential(activeCapability);
  if (!active) {
    return NextResponse.json(
      { error: `No active ${capability} provider to rotate the key for — configure one in Admin → AI Models first.` },
      { status: 400 },
    );
  }
  if (!active.model) {
    return NextResponse.json({ error: 'The active provider has no model chosen — fix this in Admin → AI Models first.' }, { status: 400 });
  }

  let validatedModels;
  try {
    validatedModels = await listModelsForProvider(active.provider, activeCapability, {
      apiKey,
      baseUrl: active.baseUrl ?? undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not validate this key.' }, { status: 400 });
  }
  if (!validatedModels.some((m) => m.id === active.model)) {
    return NextResponse.json(
      { error: `This key doesn't have access to the currently configured model ("${active.model}").` },
      { status: 400 },
    );
  }

  await saveProviderCredential({
    capability: activeCapability,
    provider: active.provider,
    apiKey,
    baseUrl: active.baseUrl,
    model: active.model,
    updatedById: ctx.userId,
  });
  await setActiveProvider({ capability: activeCapability, provider: active.provider, updatedById: ctx.userId });

  await logAuditEvent({
    action: 'AI_PROVIDER_ACTIVATED',
    result: 'SUCCESS',
    userId: ctx.userId,
    resource: `${capability}:${active.provider}`,
    metadata: { capability, provider: active.provider, model: active.model, viaScript: true },
  });

  return NextResponse.json({ ok: true, provider: active.provider, model: active.model });
}
