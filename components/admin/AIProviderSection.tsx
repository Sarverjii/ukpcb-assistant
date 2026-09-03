'use client';

import { useState, useTransition } from 'react';
import { Check, ShieldCheck, ShieldAlert, DollarSign, RotateCcw, RefreshCw, Loader2 } from 'lucide-react';
import type { AICapability, AIProviderKind } from '@prisma/client';
import {
  saveAndActivateProviderAction,
  deactivateProviderAction,
  fetchModelsAction,
  refreshModelsAction,
  reembedStaleChunksBatchAction,
} from '@/app/(app)/admin/ai-providers/actions';
import { findPricingForModel, OLLAMA_PRICING, PRICING_LAST_VERIFIED, type PricingEntry } from '@/lib/ai/pricing';
import type { DiscoveredModel } from '@/lib/ai/modelDiscovery';
import { ReauthDialog } from '@/components/admin/ReauthDialog';
import { LocalTime } from '@/components/admin/LocalTime';

type ProviderRow = {
  capability: AICapability;
  provider: AIProviderKind;
  isConfigured: boolean;
  baseUrl: string | null;
  model: string | null;
  isActive: boolean;
  updatedAt: Date;
  updatedByName: string | null;
};

const PROVIDER_LABELS: Record<AIProviderKind, string> = {
  ANTHROPIC: 'Claude (Anthropic)',
  GEMINI: 'Gemini (Google)',
  OPENAI: 'ChatGPT (OpenAI)',
  OLLAMA: 'Ollama (self-hosted)',
};

const KEY_PROVIDERS = new Set<AIProviderKind>(['ANTHROPIC', 'GEMINI', 'OPENAI']);

function pricingFor(provider: AIProviderKind, capability: AICapability, modelId: string): PricingEntry | null {
  if (provider === 'OLLAMA') return OLLAMA_PRICING;
  return findPricingForModel(capability, modelId);
}

/**
 * One capability's provider/model picker — every real model this app can
 * use is LIVE-fetched from the provider's own API using whatever key was
 * just typed (see lib/ai/modelDiscovery.ts), never a hand-maintained list:
 * that live fetch IS the "is this key valid" check too — a bad key simply
 * fails to list anything, and nothing is ever saved or activated unless it
 * succeeds. Dollar pricing (which no provider exposes via API) stays a
 * dated, hand-maintained reference (lib/ai/pricing.ts) shown next to each
 * model so an admin can compare costs before ever pasting a key.
 */
export function AIProviderSection({
  capability,
  title,
  description,
  providers,
  staleEmbeddingCount = 0,
}: {
  capability: AICapability;
  title: string;
  description: string;
  providers: ProviderRow[];
  // EMBEDDING only — how many chunks were embedded with something other
  // than the currently active provider/model, per
  // lib/db/queries/chunks.ts::countStaleEmbeddings. See
  // EmbeddingProvider's own comment for why this matters: those chunks'
  // vectors live in a different semantic space than a query embedded
  // right now, so retrieval against them is close to random.
  staleEmbeddingCount?: number;
}) {
  const active = providers.find((p) => p.isActive) ?? null;
  const [changing, setChanging] = useState(false);
  const [pending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [staleCount, setStaleCount] = useState(staleEmbeddingCount);
  const [reembedProgress, setReembedProgress] = useState<{ done: number; error?: string } | null>(null);
  const [showReembedReauth, setShowReembedReauth] = useState(false);
  const [reembedding, setReembedding] = useState(false);

  async function runReembedLoop(password?: string) {
    setReembedding(true);
    setReembedProgress({ done: 0 });
    let done = 0;
    let firstCall = true;
    for (;;) {
      const result = await reembedStaleChunksBatchAction(firstCall ? password : undefined);
      firstCall = false;
      if (result.error) {
        setReembedProgress({ done, error: result.error });
        setReembedding(false);
        return;
      }
      done += result.processed;
      setStaleCount(result.remaining);
      setReembedProgress({ done });
      if (result.remaining <= 0 || result.processed === 0) break;
    }
    setReembedding(false);
  }

  function handleDeactivate() {
    startTransition(async () => {
      await deactivateProviderAction(capability);
    });
  }

  function handleRefresh() {
    if (!active) return;
    setRefreshError(null);
    startTransition(async () => {
      const result = await refreshModelsAction(capability, active.provider);
      if (result.error) setRefreshError(result.error);
      else setRefreshedAt(new Date());
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>

      {active ? (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-white">
                  Currently using {PROVIDER_LABELS[active.provider]}
                </p>
                <p className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">{active.model}</p>
                {active.updatedByName && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Set by {active.updatedByName} on <LocalTime iso={active.updatedAt.toISOString()} />
                    {refreshedAt && ` · re-verified just now`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
              </button>
              <button
                type="button"
                onClick={() => setChanging((c) => !c)}
                className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800"
              >
                {changing ? 'Cancel' : 'Change'}
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                <RotateCcw size={13} /> Turn off
              </button>
            </div>
          </div>
          {refreshError && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <ShieldAlert size={13} /> Re-verification failed: {refreshError} — this provider may have stopped working.
            </p>
          )}
          {capability === 'EMBEDDING' && staleCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <ShieldAlert size={13} className="shrink-0" />
                {staleCount} chunk{staleCount === 1 ? '' : 's'} were embedded with a different model — retrieval
                for {staleCount === 1 ? 'it' : 'them'} is degraded until re-embedded.
              </p>
              <button
                type="button"
                disabled={reembedding}
                onClick={() => setShowReembedReauth(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 disabled:opacity-60"
              >
                {reembedding ? <Loader2 size={13} className="animate-spin" /> : null}
                {reembedding ? 'Re-embedding…' : 'Re-embed now'}
              </button>
            </div>
          )}
          {reembedProgress && (
            <p className="text-xs text-zinc-500">
              {reembedProgress.error
                ? `Re-embedding stopped after ${reembedProgress.done}: ${reembedProgress.error}`
                : reembedding
                  ? `Re-embedded ${reembedProgress.done} so far…`
                  : `Done — re-embedded ${reembedProgress.done} chunk${reembedProgress.done === 1 ? '' : 's'}.`}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
            <ShieldAlert size={16} /> No {capability === 'LLM' ? 'chat/query' : 'embedding'} provider is active.
          </p>
          <button
            type="button"
            onClick={() => setChanging((c) => !c)}
            className="rounded-lg bg-brand-700 dark:bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500"
          >
            {changing ? 'Cancel' : 'Set up a provider'}
          </button>
        </div>
      )}

      {changing && (
        <ChangeProviderPanel
          capability={capability}
          providers={providers}
          onDone={() => setChanging(false)}
        />
      )}

      {showReembedReauth && (
        <ReauthDialog
          title="Re-embed stale chunks"
          description={`Recomputes ${staleCount} chunk${staleCount === 1 ? '' : 's'}' vectors with the currently active embedding model, in bounded batches — this can take a while for a large backlog. Nothing else about the documents changes.`}
          confirmLabel="Start"
          onConfirm={async (password) => {
            runReembedLoop(password);
            return {};
          }}
          onClose={() => setShowReembedReauth(false)}
        />
      )}
    </section>
  );
}

function ChangeProviderPanel({
  capability,
  providers,
  onDone,
}: {
  capability: AICapability;
  providers: ProviderRow[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<AIProviderKind>(providers[0].provider);
  const row = providers.find((p) => p.provider === selected)!;
  const needsKey = KEY_PROVIDERS.has(selected);

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(row.baseUrl ?? (selected === 'OLLAMA' ? 'http://localhost:11434' : ''));
  const [models, setModels] = useState<DiscoveredModel[] | null>(null);
  const [chosenModel, setChosenModel] = useState<string>('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchPending, startFetchTransition] = useTransition();
  const [showReauth, setShowReauth] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function selectProvider(next: AIProviderKind) {
    setSelected(next);
    const r = providers.find((p) => p.provider === next)!;
    setApiKey('');
    setBaseUrl(r.baseUrl ?? (next === 'OLLAMA' ? 'http://localhost:11434' : ''));
    setModels(null);
    setChosenModel('');
    setFetchError(null);
  }

  function handleFetchModels() {
    setFetchError(null);
    setModels(null);
    setChosenModel('');
    startFetchTransition(async () => {
      const result = await fetchModelsAction(capability, selected, apiKey, baseUrl);
      if (result.error) setFetchError(result.error);
      else {
        setModels(result.models ?? []);
        if (result.models?.length === 1) setChosenModel(result.models[0].id);
      }
    });
  }

  async function confirmSave(password: string) {
    const formData = new FormData();
    formData.set('capability', capability);
    formData.set('provider', selected);
    formData.set('apiKey', apiKey);
    formData.set('baseUrl', baseUrl);
    formData.set('model', chosenModel);
    formData.set('password', password);
    const result = await saveAndActivateProviderAction(formData);
    if (!result.error) onDone();
    return result;
  }

  const canFetch = selected === 'OLLAMA' ? true : apiKey.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p.provider}
            type="button"
            onClick={() => selectProvider(p.provider)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selected === p.provider
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {PROVIDER_LABELS[p.provider]}
            {p.isConfigured && <Check size={11} className="ml-1 inline" />}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {needsKey ? (
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={row.isConfigured ? 'Already saved — enter a new key to replace it, or leave blank to reuse it' : 'Paste your API key'}
              autoComplete="off"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
            />
          </label>
        ) : (
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Server URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            />
          </label>
        )}
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={!canFetch || fetchPending}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-zinc-800 dark:bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-900 dark:hover:bg-zinc-600 disabled:opacity-50"
        >
          {fetchPending ? <Loader2 size={14} className="animate-spin" /> : null}
          Load available models
        </button>
      </div>
      {selected === 'OLLAMA' && (
        <p className="text-xs text-zinc-400">
          Won&apos;t reach anything on this deployment — ready for when this app moves to a self-hosted
          server that can actually reach an Ollama instance.
        </p>
      )}

      {fetchError && (
        <p className="flex items-center gap-1.5 rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          <ShieldAlert size={14} className="shrink-0" /> {fetchError}
        </p>
      )}

      {models && models.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {models.length} model{models.length === 1 ? '' : 's'} available with this key — pick one:
          </p>
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {models.map((m) => {
              const pricing = pricingFor(selected, capability, m.id);
              return (
                <label
                  key={m.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors ${
                    chosenModel === m.id
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="model"
                      checked={chosenModel === m.id}
                      onChange={() => setChosenModel(m.id)}
                    />
                    <span className="font-mono text-xs font-medium text-zinc-900 dark:text-white">{m.id}</span>
                    {pricing?.freeTierAvailable && (
                      <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        free tier available
                      </span>
                    )}
                    {pricing?.inputPerMillion === 0 && (
                      <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        free
                      </span>
                    )}
                  </span>
                  {m.displayName && m.displayName !== m.id && (
                    <span className="pl-6 text-xs text-zinc-500">{m.displayName}</span>
                  )}
                  <span className="flex items-start gap-1.5 pl-6 text-xs text-zinc-500 dark:text-zinc-400">
                    <DollarSign size={11} className="mt-0.5 shrink-0" />
                    {pricing ? (
                      <span>
                        {pricing.inputPerMillion !== null ? (
                          <>
                            ${pricing.inputPerMillion} / 1M input
                            {pricing.outputPerMillion !== null && <> · ${pricing.outputPerMillion} / 1M output</>}
                          </>
                        ) : (
                          pricing.note ?? 'Check the pricing page.'
                        )}{' '}
                        <a
                          href={pricing.officialPricingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="underline hover:text-brand-600"
                        >
                          verify
                        </a>{' '}
                        (as of {PRICING_LAST_VERIFIED})
                      </span>
                    ) : (
                      <span>No pricing on file for this exact model — check the provider&apos;s pricing page.</span>
                    )}
                  </span>
                  {(m.inputTokenLimit || m.outputTokenLimit) && (
                    <span className="pl-6 text-[11px] text-zinc-400">
                      {m.inputTokenLimit && `${m.inputTokenLimit.toLocaleString()} input tokens`}
                      {m.inputTokenLimit && m.outputTokenLimit && ' · '}
                      {m.outputTokenLimit && `${m.outputTokenLimit.toLocaleString()} output tokens`}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      {chosenModel && (
        <button
          type="button"
          onClick={() => setShowReauth(true)}
          className="self-start rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500"
        >
          Save &amp; activate
        </button>
      )}

      {showReauth && (
        <ReauthDialog
          title={`Activate ${PROVIDER_LABELS[selected]}`}
          description={`This becomes the live ${capability === 'LLM' ? 'chat/query' : 'embedding'} provider for every request immediately, using ${chosenModel}.`}
          confirmLabel="Save & activate"
          onConfirm={async (password) => {
            const result = await confirmSave(password);
            if (result.error) setSaveError(result.error);
            return result;
          }}
          onClose={() => setShowReauth(false)}
        />
      )}
    </div>
  );
}
