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

/**
 * True when a rate-limit error (see isRateLimitError above) is
 * specifically Gemini's free-tier DAILY quota (a "...PerDay..." quotaId,
 * confirmed directly: e.g.
 * "EmbedContentRequestsPerDayPerProjectPerModel-FreeTier"), as opposed to
 * its much shorter PER-MINUTE one. The distinction matters for what an
 * admin should actually DO about it: a per-minute limit clears on its own
 * within roughly a minute, so retrying — with the same key or a new one —
 * genuinely helps. A daily limit does not: it's scoped to the API key's
 * underlying Google Cloud PROJECT, not the literal key string, so pasting
 * "a new key" only helps if it comes from a genuinely different Google
 * account/project — two keys from the same AI Studio account share the
 * exact same daily allowance and will hit this identically, immediately,
 * no matter how many times you swap between them (confirmed directly:
 * a key that worked in isolation hit this again within a few dozen
 * requests once real document processing resumed). Without this
 * distinction, an admin retrying a daily-capped document sees what looks
 * like the SAME "give me a new key" prompt fail over and over and has no
 * way to tell that's expected, not a bug — see KnowledgeBase.tsx and
 * DocumentsTable.tsx for where this changes the message shown.
 */
export function isDailyQuotaError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /perday/i.test(message);
}
