'use client';

import { useState, useTransition } from 'react';
import { Check, ShieldCheck, DollarSign, RotateCcw } from 'lucide-react';
import type { AICapability, AIProviderKind } from '@prisma/client';
import { saveAndActivateProviderAction, deactivateProviderAction } from '@/app/(app)/admin/ai-providers/actions';
import { getPricingEntry, PRICING_LAST_VERIFIED } from '@/lib/ai/pricing';
import { ReauthDialog } from '@/components/admin/ReauthDialog';

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

/**
 * One capability's provider picker — the dropdown drives everything below
 * it: pricing, which fields apply, and what's currently saved for that
 * specific provider. Selecting a different option never shows a
 * previously-saved API key (write-only, by design — see
 * saveAndActivateProviderAction's own comment); it only shows whether one
 * is already on file and lets you overwrite it.
 */
export function AIProviderSection({
  capability,
  title,
  description,
  providers,
}: {
  capability: AICapability;
  title: string;
  description: string;
  providers: ProviderRow[];
}) {
  const [selected, setSelected] = useState<AIProviderKind>(providers.find((p) => p.isActive)?.provider ?? providers[0].provider);
  const row = providers.find((p) => p.provider === selected)!;
  const pricing = getPricingEntry(capability, selected);
  const needsKey = KEY_PROVIDERS.has(selected);

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(row.baseUrl ?? (selected === 'OLLAMA' ? 'http://localhost:11434' : ''));
  const [model, setModel] = useState(row.model ?? '');
  const [showReauth, setShowReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Switching the provider dropdown resets the form fields to match the
  // newly-selected provider's own saved state — done directly in the
  // change handler (not a useEffect keyed on `selected`) since this is
  // reacting to a user event, not synchronizing with an external system.
  function handleProviderChange(next: AIProviderKind) {
    setSelected(next);
    const r = providers.find((p) => p.provider === next)!;
    setApiKey('');
    setBaseUrl(r.baseUrl ?? (next === 'OLLAMA' ? 'http://localhost:11434' : ''));
    setModel(r.model ?? '');
    setError(null);
  }

  async function confirmSave(password: string) {
    const formData = new FormData();
    formData.set('capability', capability);
    formData.set('provider', selected);
    formData.set('apiKey', apiKey);
    formData.set('baseUrl', baseUrl);
    formData.set('model', model);
    formData.set('password', password);
    const result = await saveAndActivateProviderAction(formData);
    if (!result.error) setApiKey('');
    return result;
  }

  function handleDeactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateProviderAction(capability);
      if (result.error) setError(result.error);
    });
  }

  const activeRow = providers.find((p) => p.isActive);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs">
          {activeRow ? (
            <>
              <ShieldCheck size={13} className="text-emerald-600" />
              <span className="text-zinc-600 dark:text-zinc-300">
                Currently active: <span className="font-medium">{PROVIDER_LABELS[activeRow.provider]}</span>
                {activeRow.updatedByName && ` — set by ${activeRow.updatedByName}`}
              </span>
            </>
          ) : (
            <span className="text-zinc-400">Using this deployment&apos;s environment-variable default.</span>
          )}
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Provider</span>
        <select
          value={selected}
          onChange={(e) => handleProviderChange(e.target.value as AIProviderKind)}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        >
          {providers.map((p) => (
            <option key={p.provider} value={p.provider}>
              {PROVIDER_LABELS[p.provider]}
              {p.isActive ? ' — Active' : p.isConfigured ? ' — Configured' : ''}
            </option>
          ))}
        </select>
      </label>

      {pricing && (
        <div className="flex items-start gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">
          <DollarSign size={14} className="mt-0.5 shrink-0 text-zinc-400" />
          <div>
            <p className="font-medium text-zinc-700 dark:text-zinc-200">{pricing.label}</p>
            <p>
              {pricing.inputPerMillion === 0 ? (
                'Free — no per-token API cost'
              ) : (
                <>
                  ${pricing.inputPerMillion} / 1M input tokens
                  {pricing.outputPerMillion !== null && <> · ${pricing.outputPerMillion} / 1M output tokens</>}
                </>
              )}
            </p>
            {pricing.note && <p className="mt-0.5 text-zinc-400">{pricing.note}</p>}
            <p className="mt-1 text-zinc-400">
              Approximate, as of {PRICING_LAST_VERIFIED} —{' '}
              <a href={pricing.officialPricingUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-600">
                check current pricing
              </a>
              .
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {needsKey && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={row.isConfigured ? 'Already saved — enter a new key to replace it' : 'Paste your API key'}
              autoComplete="off"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
            />
            {row.isConfigured && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check size={12} /> A key is saved for this provider — it&apos;s never shown again, only replaced.
              </span>
            )}
          </label>
        )}
        {selected === 'OLLAMA' && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Server URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            />
            <span className="text-xs text-zinc-400">
              Won&apos;t reach anything on this deployment — ready for when this app moves to a
              self-hosted server that can actually reach an Ollama instance.
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Model override (optional)</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave blank to use the default"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowReauth(true)}
          className="rounded-lg bg-brand-700 dark:bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:hover:bg-brand-500"
        >
          Save &amp; activate
        </button>
        {row.isActive && (
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60"
          >
            <RotateCcw size={13} /> Revert to environment default
          </button>
        )}
      </div>

      {showReauth && (
        <ReauthDialog
          title={`Activate ${PROVIDER_LABELS[selected]}`}
          description={`This becomes the live ${capability === 'LLM' ? 'chat/query' : 'embedding'} provider for every request immediately.`}
          confirmLabel="Save & activate"
          onConfirm={async (password) => {
            const result = await confirmSave(password);
            if (result.error) setError(result.error);
            return result;
          }}
          onClose={() => setShowReauth(false)}
        />
      )}
    </section>
  );
}
