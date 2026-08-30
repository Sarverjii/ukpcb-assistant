/**
 * Catches a real, measured failure mode of the local embedding model
 * (Xenova/all-MiniLM-L6-v2): a short, list-like chunk — e.g. a bare bullet
 * list of tool names ("Tools – VPN, Git, Selenium, Jira, ...") inside a
 * larger case-study document — can score so low on cosine similarity
 * against a natural-language question ("what tools were used?") that it
 * never lands in the top results, EVEN restricted to just that one
 * document's own handful of chunks (measured directly: it ranked #8 of 9
 * within its own document). No amount of raising TOP_K or lowering
 * SIMILARITY_THRESHOLD fixes this — the semantic match is genuinely weak,
 * not merely borderline.
 *
 * This corpus's documents are named after the client/project they cover
 * ("Case Study - Rent", "Case Study - Gamentio", ...), and questions about
 * one very often name it directly ("in the project rent, what tools were
 * used"). That's a strong, non-semantic signal retrieval was ignoring
 * entirely. This module extracts the DISTINCTIVE word(s) from each
 * accessible document's name and checks whether the question mentions one
 * as a whole word — if so, lib/rag/chat.ts pulls chunks from that document
 * directly (see retrieveChunksForDocuments in lib/db/queries/chunks.ts)
 * instead of trusting embedding similarity alone to surface them.
 *
 * Deliberately excludes generic/boilerplate words that recur across many
 * titles in this corpus ("Case", "Study", "Guidelines", "Process", ...) so
 * a document only matches on what actually distinguishes it. A false
 * positive here only means a *little* extra authorized context reaches the
 * model — every candidate chunk still passes through the exact same
 * clearance filter as normal vector retrieval, so this can never surface
 * anything the caller isn't cleared for.
 */
const GENERIC_NAME_WORDS = new Set([
  'case',
  'study',
  'studies',
  'copy',
  'of',
  'and',
  'the',
  'to',
  'for',
  'process',
  'guidelines',
  'presentation',
  'technical',
  'expertise',
  'implementation',
  'strategy',
  'strategies',
  'rate',
  'card',
  'migration',
  'profile',
  'project',
  'technologies',
  'technology',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function distinctiveTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && /[a-z]/.test(w) && !GENERIC_NAME_WORDS.has(w));
}

/**
 * Returns the ids of accessible documents whose name is directly
 * referenced by the question. `documents` must already be clearance-
 * filtered (the caller passes the same list used to build the inventory)
 * — this function only decides WHICH of those the question names, it does
 * not itself perform any authorization check.
 */
export function matchDocumentsByName(
  question: string,
  documents: { id: string; name: string }[],
): string[] {
  const q = question.toLowerCase();
  const matched: string[] = [];
  for (const doc of documents) {
    const tokens = distinctiveTokens(doc.name);
    if (tokens.length === 0) continue;
    const hit = tokens.some((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(q));
    if (hit) matched.push(doc.id);
  }
  return matched;
}
