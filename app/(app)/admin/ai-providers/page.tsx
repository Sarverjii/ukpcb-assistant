import { listProviderCredentialsSummary, type ProviderCredentialSummary } from '@/lib/db/queries/aiProviders';
import { AIProviderSection } from '@/components/admin/AIProviderSection';
import type { AICapability, AIProviderKind } from '@prisma/client';

const LLM_PROVIDERS: AIProviderKind[] = ['ANTHROPIC', 'GEMINI', 'OLLAMA'];
const EMBEDDING_PROVIDERS: AIProviderKind[] = ['GEMINI', 'OPENAI', 'OLLAMA'];

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

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Pick which AI provider handles chat/query and which handles embeddings — switch anytime,
        right here, no redeploy. A saved API key is encrypted and can never be viewed again once
        saved, only replaced. Leaving a provider unconfigured falls back to this deployment&apos;s
        environment-variable settings, exactly as before this page existed.
      </p>

      <AIProviderSection
        capability="LLM"
        title="Chat / query model"
        description="Answers every question in chat — safe to switch anytime, nothing is stored per-provider."
        providers={forCapability(rows, 'LLM', LLM_PROVIDERS)}
      />

      <AIProviderSection
        capability="EMBEDDING"
        title="Embedding model"
        description="Turns documents and questions into vectors for retrieval. Switching does NOT re-embed documents already indexed — existing retrieval quality may degrade until they're re-uploaded, so switch deliberately, not casually."
        providers={forCapability(rows, 'EMBEDDING', EMBEDDING_PROVIDERS)}
      />
    </div>
  );
}
