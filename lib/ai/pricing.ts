import type { AICapability, AIProviderKind } from '@prisma/client';

/**
 * A static, hand-maintained reference table — none of these providers
 * expose a live pricing API, so this can't be fetched at runtime. Shown
 * on the Admin -> AI Models page directly under each provider's dropdown
 * entry, purely informational (never used in any billing/limit logic in
 * this app). Figures are approximate list prices per 1M tokens, gathered
 * September 2026 from each provider's public pricing page and third-party
 * trackers — provider pricing changes over time, so this table intentionally
 * carries a visible "as of" date and a link out to the real page rather
 * than presenting itself as authoritative.
 */
export const PRICING_LAST_VERIFIED = 'September 2026';

export type PricingEntry = {
  label: string;
  inputPerMillion: number | null; // null = free / self-hosted
  outputPerMillion: number | null; // null when the provider has no separate output cost (embeddings)
  note?: string;
  officialPricingUrl: string;
};

const LLM_PRICING: Partial<Record<AIProviderKind, PricingEntry>> = {
  ANTHROPIC: {
    label: 'Claude Sonnet (default model)',
    inputPerMillion: 3,
    outputPerMillion: 15,
    note: 'Haiku is cheaper (~$1 / $5 per 1M) if you set a lighter model.',
    officialPricingUrl: 'https://www.anthropic.com/pricing#api',
  },
  GEMINI: {
    label: 'Gemini Flash-Lite (default model)',
    inputPerMillion: 0.15,
    outputPerMillion: 1.25,
    note: 'Free tier available with rate limits; Pro-tier models cost substantially more.',
    officialPricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  OLLAMA: {
    label: 'Self-hosted — no per-token API cost',
    inputPerMillion: 0,
    outputPerMillion: 0,
    note: 'You pay for the server running it, not per request.',
    officialPricingUrl: 'https://ollama.com',
  },
};

const EMBEDDING_PRICING: Partial<Record<AIProviderKind, PricingEntry>> = {
  GEMINI: {
    label: 'Gemini Embedding',
    inputPerMillion: 0.15,
    outputPerMillion: null,
    officialPricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  OPENAI: {
    label: 'text-embedding-3-small',
    inputPerMillion: 0.02,
    outputPerMillion: null,
    officialPricingUrl: 'https://openai.com/api/pricing/',
  },
  OLLAMA: {
    label: 'Self-hosted — no per-token API cost',
    inputPerMillion: 0,
    outputPerMillion: null,
    note: 'You pay for the server running it, not per request.',
    officialPricingUrl: 'https://ollama.com',
  },
};

export function getPricingEntry(capability: AICapability, provider: AIProviderKind): PricingEntry | null {
  const table = capability === 'LLM' ? LLM_PRICING : EMBEDDING_PRICING;
  return table[provider] ?? null;
}
