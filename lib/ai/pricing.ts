/**
 * A static, hand-maintained pricing reference — matched against whatever
 * real model id the live catalog (lib/ai/modelDiscovery.ts) returns, by
 * substring, so it survives providers renaming/versioning a model without
 * needing a code change for every release. Shown so an admin can compare
 * costs BEFORE ever pasting a key — none of these providers expose a live
 * pricing API, so this can't be fetched at request time; it's refreshed by
 * hand periodically (see PRICING_LAST_VERIFIED) rather than claimed to be
 * live. The admin page's "Refresh" button re-fetches the LIVE MODEL LIST
 * (proving the key still works and pulling real per-model metadata like
 * context length) — it does not and cannot pull live dollar pricing from
 * any of these APIs; the copy next to that button says so explicitly.
 */
export const PRICING_LAST_VERIFIED = 'September 2026';

export type PricingEntry = {
  label: string;
  inputPerMillion: number | null; // null = free / self-hosted / no figure on file
  outputPerMillion: number | null; // null when there's no separate output cost (embeddings) or no figure on file
  freeTierAvailable?: boolean;
  note?: string;
  officialPricingUrl: string;
};

type Rule = { test: RegExp; entry: PricingEntry };

const ANTHROPIC_PRICING_URL = 'https://www.anthropic.com/pricing#api';
const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI_PRICING_URL = 'https://openai.com/api/pricing/';

const LLM_RULES: Rule[] = [
  { test: /haiku/i, entry: { label: 'Claude Haiku', inputPerMillion: 1, outputPerMillion: 5, officialPricingUrl: ANTHROPIC_PRICING_URL } },
  { test: /sonnet/i, entry: { label: 'Claude Sonnet', inputPerMillion: 3, outputPerMillion: 15, officialPricingUrl: ANTHROPIC_PRICING_URL } },
  { test: /opus/i, entry: { label: 'Claude Opus', inputPerMillion: null, outputPerMillion: null, note: 'Premium tier — check the pricing page for the current rate.', officialPricingUrl: ANTHROPIC_PRICING_URL } },
  { test: /flash-lite/i, entry: { label: 'Gemini Flash-Lite', inputPerMillion: 0.15, outputPerMillion: 1.25, freeTierAvailable: true, officialPricingUrl: GEMINI_PRICING_URL } },
  { test: /flash/i, entry: { label: 'Gemini Flash', inputPerMillion: 0.75, outputPerMillion: 3.75, freeTierAvailable: true, officialPricingUrl: GEMINI_PRICING_URL } },
  { test: /pro/i, entry: { label: 'Gemini Pro', inputPerMillion: 2, outputPerMillion: 12, officialPricingUrl: GEMINI_PRICING_URL } },
  { test: /sol/i, entry: { label: 'GPT — Sol tier', inputPerMillion: 5, outputPerMillion: 30, officialPricingUrl: OPENAI_PRICING_URL } },
  { test: /terra/i, entry: { label: 'GPT — Terra tier', inputPerMillion: 2, outputPerMillion: 12, officialPricingUrl: OPENAI_PRICING_URL } },
  { test: /luna/i, entry: { label: 'GPT — Luna tier (cheapest)', inputPerMillion: 0.2, outputPerMillion: 1.2, officialPricingUrl: OPENAI_PRICING_URL } },
  { test: /mini|nano/i, entry: { label: 'GPT — lighter variant', inputPerMillion: null, outputPerMillion: null, note: 'Cheaper than the base tier — check the pricing page for the current rate.', officialPricingUrl: OPENAI_PRICING_URL } },
];

const EMBEDDING_RULES: Rule[] = [
  { test: /embedding-3-small/i, entry: { label: 'text-embedding-3-small', inputPerMillion: 0.02, outputPerMillion: null, officialPricingUrl: OPENAI_PRICING_URL } },
  { test: /embedding-3-large/i, entry: { label: 'text-embedding-3-large', inputPerMillion: null, outputPerMillion: null, note: 'Check the pricing page for the current rate.', officialPricingUrl: OPENAI_PRICING_URL } },
  { test: /embedding/i, entry: { label: 'Gemini Embedding', inputPerMillion: 0.15, outputPerMillion: null, freeTierAvailable: true, officialPricingUrl: GEMINI_PRICING_URL } },
];

/**
 * Looks up a pricing entry by matching `modelId` against known model-name
 * patterns — first match wins. Returns null when nothing on file matches
 * (a brand-new or unusual model id), in which case the UI should say so
 * plainly rather than guessing.
 */
export function findPricingForModel(capability: 'LLM' | 'EMBEDDING', modelId: string): PricingEntry | null {
  const rules = capability === 'LLM' ? LLM_RULES : EMBEDDING_RULES;
  for (const rule of rules) {
    if (rule.test.test(modelId)) return rule.entry;
  }
  return null;
}

/** Ollama is always free (self-hosted) regardless of which model is pulled — no lookup needed. */
export const OLLAMA_PRICING: PricingEntry = {
  label: 'Self-hosted',
  inputPerMillion: 0,
  outputPerMillion: 0,
  note: 'You pay for the server running it, not per request.',
  officialPricingUrl: 'https://ollama.com',
};
