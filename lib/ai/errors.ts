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

/**
 * True when a document's stored processingError (Document.processingError
 * — the raw message setDocumentStatus(id, 'FAILED', message) recorded)
 * looks like the provider's own rate-limit/quota-exhausted response
 * rather than a real, permanent problem with the document itself (a
 * corrupt file, unsupported content, a truly unreadable page). The
 * distinction matters because a rate-limited document is worth surfacing
 * differently — it's not broken, it just needs the SAME processing
 * retried once the provider's quota has room again or its API key is
 * swapped for a fresh one — whereas a genuine per-document failure won't
 * fix itself by retrying and would just mislead an admin into thinking a
 * key swap should help.
 *
 * Deliberately provider-agnostic (string matching, not a Gemini-specific
 * error shape): confirmed directly against Gemini's free-tier 429
 * ("RESOURCE_EXHAUSTED"/"quota"), and the same patterns cover the
 * standard shape most other providers' rate-limit errors use too (a
 * literal "429" or "rate limit" in the message).
 *
 * Client-safe: no Node-only imports, so components under 'use client'
 * (the Knowledge Base banner, DocumentsTable's per-row Retry button) can
 * import this directly instead of duplicating the pattern.
 */
export function isRateLimitError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /resource_exhausted|rate.?limit(?:ed)?|quota|\b429\b|too many requests/i.test(message);
}
