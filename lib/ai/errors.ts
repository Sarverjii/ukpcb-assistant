/**
 * Thrown by getLLMProvider()/getEmbeddingProvider() when no provider is
 * currently activated for that capability — there is no env-var fallback
 * anymore (see both factories' own comments): every deployment must have
 * an admin configure and activate a real provider from Admin -> AI
 * Models before chat or document processing can work at all. Caught
 * specifically wherever a friendly "not configured" message matters (the
 * chat pages' banner, the chat route's error response) rather than
 * surfacing as a generic failure.
 */
export class NoActiveProviderError extends Error {
  constructor(capability: 'LLM' | 'EMBEDDING') {
    super(
      capability === 'LLM'
        ? 'No chat/query AI provider is configured yet.'
        : 'No embedding AI provider is configured yet.',
    );
    this.name = 'NoActiveProviderError';
  }
}
