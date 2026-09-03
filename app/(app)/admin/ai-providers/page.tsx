import { ShieldAlert } from 'lucide-react';
import { listProviderCredentialsSummary, type ProviderCredentialSummary } from '@/lib/db/queries/aiProviders';
import { AIProviderSection } from '@/components/admin/AIProviderSection';
import type { AICapability, AIProviderKind } from '@prisma/client';

// Every provider that offers this capability at all — Claude and OpenAI
// both work fine for chat, and Gemini/OpenAI both work for embeddings.
// Anthropic is deliberately included as an EMBEDDING option too (per an
// explicit request to always show Gemini/OpenAI/Claude in both lists):
// picking it there surfaces modelDiscovery's own honest
// "Anthropic does not offer a public embeddings API" error inline, rather
// than this page silently hiding the option.
const LLM_PROVIDERS: AIProviderKind[] = ['GEMINI', 'OPENAI', 'ANTHROPIC', 'OLLAMA'];
const EMBEDDING_PROVIDERS: AIProviderKind[] = ['GEMINI', 'OPENAI', 'ANTHROPIC', 'OLLAMA'];

function forCapability(
  rows: ProviderCredentialSummary[],
  capability: AICapability,
  wanted: AIProviderKind[],
): ProviderCredentialSummary[] {
  const byProvider = new Map(rows.filter((r) => r.capability === capability).map((r) => [r.provider, r]));
  return wanted.map(
    (provider): ProviderCredentialSummary =>
      byProvider.get(provider) ?? {
        capability,
        provider,
        isConfigured: false,
        baseUrl: null,
        model: null,
        isActive: false,
        updatedAt: new Date(0),
        updatedByName: null,
      },
  );
}

export default async function AIProvidersPage() {
  const rows = await listProviderCredentialsSummary();
  const llmProviders = forCapability(rows, 'LLM', LLM_PROVIDERS);
  const embeddingProviders = forCapability(rows, 'EMBEDDING', EMBEDDING_PROVIDERS);
  const missing = [
    !llmProviders.some((p) => p.isActive) && 'chat/query',
    !embeddingProviders.some((p) => p.isActive) && 'embedding',
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="flex flex-col gap-8">
      {missing.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-400">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <p>
            No {missing.join(' and ')} provider is active. Ask Evon cannot{' '}
            {missing.includes('chat/query') && 'answer chat questions'}
            {missing.length === 2 && ' or '}
            {missing.includes('embedding') && 'process/search documents'} until one is set up below —
            every employee sees an error until this is fixed.
          </p>
        </div>
      )}

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Pick which AI provider handles chat/query and which handles embeddings — switch anytime,
        right here, no redeploy. Every model shown is fetched live from the provider you enter a key
        for (that fetch doubles as proof the key actually works — nothing saves or activates on a bad
        key). A saved API key is encrypted at rest and can never be viewed again once saved, only
        replaced or removed.
      </p>

      <AIProviderSection
        capability="LLM"
        title="Chat / query model"
        description="Answers every question in chat."
        providers={llmProviders}
      />

      <AIProviderSection
        capability="EMBEDDING"
        title="Embedding model"
        description="Turns documents and questions into vectors for retrieval. Switching does NOT re-embed documents already indexed — existing retrieval quality may degrade until they're re-uploaded, so switch deliberately, not casually."
        providers={embeddingProviders}
      />
    </div>
  );
}
