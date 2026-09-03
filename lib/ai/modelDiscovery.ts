import { GoogleGenAI } from '@google/genai';
import type { AICapability, AIProviderKind } from '@prisma/client';

/**
 * Live model discovery — the actual list of models a real API key/server
 * currently has access to, fetched from each provider's own API at the
 * moment an admin is configuring one. This is deliberately NOT a
 * hand-maintained catalog (see lib/ai/pricing.ts for the one thing that
 * genuinely can't be fetched live — dollar pricing): providers add, rename,
 * and retire models constantly, and a static list of names goes stale the
 * moment it's written. This same call also IS the "is this key valid"
 * check (see app/(app)/admin/ai-providers/actions.ts::fetchModelsAction) —
 * a bad key fails to list anything, with no separate validation call
 * needed.
 */
export type DiscoveredModel = {
  id: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export class ModelDiscoveryError extends Error {}

export async function listModelsForProvider(
  provider: AIProviderKind,
  capability: AICapability,
  credentials: { apiKey?: string; baseUrl?: string },
): Promise<DiscoveredModel[]> {
  switch (provider) {
    case 'GEMINI':
      return listGeminiModels(capability, credentials.apiKey);
    case 'OPENAI':
      return listOpenAIModels(capability, credentials.apiKey);
    case 'ANTHROPIC':
      return listAnthropicModels(capability, credentials.apiKey);
    case 'OLLAMA':
      return listOllamaModels(credentials.baseUrl);
  }
}

async function listGeminiModels(capability: AICapability, apiKey?: string): Promise<DiscoveredModel[]> {
  if (!apiKey) throw new ModelDiscoveryError('An API key is required.');
  const client = new GoogleGenAI({ apiKey });
  const wantedAction = capability === 'LLM' ? 'generateContent' : 'embedContent';

  let pager;
  try {
    pager = await client.models.list();
  } catch (err) {
    throw mapGeminiError(err);
  }

  const models: DiscoveredModel[] = [];
  try {
    for await (const m of pager) {
      if (!m.name) continue;
      if (m.supportedActions && !m.supportedActions.includes(wantedAction)) continue;
      models.push({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
      });
    }
  } catch (err) {
    throw mapGeminiError(err);
  }
  if (models.length === 0) {
    throw new ModelDiscoveryError(
      capability === 'LLM'
        ? 'This key worked, but no chat-capable models were returned.'
        : 'This key worked, but no embedding-capable models were returned.',
    );
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function mapGeminiError(err: unknown): Error {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return new ModelDiscoveryError('Gemini rejected this API key.');
  return new ModelDiscoveryError(`Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`);
}

// OpenAI's /v1/models endpoint mixes every model type together (chat,
// embeddings, image, audio, moderation) with no capability field — filtered
// here by id pattern, which is the only signal available, not a hand-typed
// list of specific model names.
async function listOpenAIModels(capability: AICapability, apiKey?: string): Promise<DiscoveredModel[]> {
  if (!apiKey) throw new ModelDiscoveryError('An API key is required.');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    throw new ModelDiscoveryError('Could not reach the OpenAI API — check network connectivity.');
  }
  if (res.status === 401 || res.status === 403) throw new ModelDiscoveryError('OpenAI rejected this API key.');
  const data = (await res.json().catch(() => ({}))) as { data?: { id: string }[]; error?: { message: string } };
  if (!res.ok || !data.data) {
    throw new ModelDiscoveryError(`Could not list OpenAI models: ${data.error?.message ?? res.statusText}`);
  }

  const NON_CAPABLE = /whisper|tts|dall-e|moderation|davinci-edit|image|audio|realtime|transcribe|search/i;
  const filtered = data.data
    .map((m) => m.id)
    .filter((id) => !NON_CAPABLE.test(id))
    .filter((id) => (capability === 'EMBEDDING' ? /embedding/i.test(id) : !/embedding/i.test(id)));

  if (filtered.length === 0) {
    throw new ModelDiscoveryError(
      capability === 'LLM'
        ? 'This key worked, but no chat-capable models were returned.'
        : 'This key worked, but no embedding-capable models were returned.',
    );
  }
  return filtered.sort().map((id) => ({ id }));
}

// Anthropic has no public embeddings API at all — this always throws for
// EMBEDDING, which is exactly what surfaces as a clear, honest inline error
// in the admin UI rather than needing a special "unavailable" case there.
async function listAnthropicModels(capability: AICapability, apiKey?: string): Promise<DiscoveredModel[]> {
  if (capability === 'EMBEDDING') {
    throw new ModelDiscoveryError('Anthropic does not offer a public embeddings API.');
  }
  if (!apiKey) throw new ModelDiscoveryError('An API key is required.');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
  } catch {
    throw new ModelDiscoveryError('Could not reach the Anthropic API — check network connectivity.');
  }
  if (res.status === 401 || res.status === 403) throw new ModelDiscoveryError('Anthropic rejected this API key.');
  const data = (await res.json().catch(() => ({}))) as {
    data?: { id: string; display_name?: string }[];
    error?: { message: string };
  };
  if (!res.ok || !data.data) {
    throw new ModelDiscoveryError(`Could not list Anthropic models: ${data.error?.message ?? res.statusText}`);
  }
  return data.data.map((m) => ({ id: m.id, displayName: m.display_name }));
}

// Ollama's /api/tags lists whatever's been `ollama pull`ed on that server —
// no capability metadata at all, so this returns the same list for both
// LLM and EMBEDDING; picking a model suited to the chosen capability is on
// the admin (a chat model won't work if activated for embeddings, and vice
// versa — the same way choosing the wrong model would fail for any
// provider once real requests start hitting it).
async function listOllamaModels(baseUrl?: string): Promise<DiscoveredModel[]> {
  const url = baseUrl || 'http://localhost:11434';
  let res: Response;
  try {
    res = await fetch(`${url}/api/tags`);
  } catch {
    throw new ModelDiscoveryError(
      `Could not reach Ollama at ${url}. Is it running, and reachable from this server?`,
    );
  }
  if (!res.ok) throw new ModelDiscoveryError(`Ollama returned an error: ${res.statusText}`);
  const data = (await res.json().catch(() => ({}))) as { models?: { name: string }[] };
  if (!data.models || data.models.length === 0) {
    throw new ModelDiscoveryError(`Ollama at ${url} has no models pulled yet — run \`ollama pull <model>\` first.`);
  }
  return data.models.map((m) => ({ id: m.name }));
}
