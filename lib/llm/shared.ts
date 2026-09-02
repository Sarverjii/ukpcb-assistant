import type { RetrievedChunk } from '@/lib/db/queries/chunks';
import type { ChatTurn, DocumentSummary } from '@/lib/llm/types';

// Shared by every LLMProvider implementation (Anthropic, Ollama, ...) so the
// context-assembly and citation-extraction logic — the parts that actually
// matter for the security/citation story — behave identically regardless of
// which model is answering.

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInventoryBlock(documentInventory: DocumentSummary[]): string {
  const items = documentInventory
    .map((d) => `<document name="${escapeXml(d.name)}">${escapeXml(d.description ?? '')}</document>`)
    .join('\n');
  return `<document_inventory count="${documentInventory.length}">\n${items}\n</document_inventory>`;
}

export function buildUserTurn(
  contextChunks: RetrievedChunk[],
  question: string,
  documentInventory?: DocumentSummary[],
): string {
  // <document_inventory> is now attached whenever it was fetched at all
  // (checked by presence, not by contextChunks.length) — independent of
  // whether this turn also has retrieved chunk content. It used to be
  // fenced off to only the no-context path, on the assumption that a
  // question landing in the "has relevant chunks" branch could never also
  // be a meta-question about the document collection; that assumption was
  // wrong (see CHAT_SYSTEM_PROMPT's comment for the exact failure this
  // caused) — the model needs both sources on every turn and picks the
  // right one itself, based on rules 1–2 there.
  //
  // Checked by presence (was it fetched at all?), not by length: an empty
  // array is a legitimate, meaningful answer ("you have zero authorized
  // documents"), not the same as "no inventory was provided". Omitting the
  // tag entirely for a length-0 array previously left the model unable to
  // distinguish "zero documents" from "I have no way to know", and it
  // (reasonably) answered the latter.
  const inventoryBlock = documentInventory ? `${buildInventoryBlock(documentInventory)}\n\n` : '';

  if (contextChunks.length === 0) {
    return `${inventoryBlock}User question: ${question}`;
  }

  const contextBlock = contextChunks
    .map(
      (c, i) =>
        `<chunk ref="${i + 1}" title="${escapeXml(c.documentName)}">\n${escapeXml(c.content)}\n</chunk>`,
    )
    .join('\n');

  return (
    `${inventoryBlock}<context>\n${contextBlock}\n</context>\n\n` +
    `User question: ${question}\n\n` +
    `If this is a substantive question about document content, answer using ONLY the <context> above and cite sources by ref number in square brackets, e.g. [1]. If it's instead a question about the document collection itself (counts, titles, what's available), answer from <document_inventory> per the system rules.`
  );
}

/**
 * Pulled real production answers where this silently dropped every
 * citation: the model cited multiple refs in one bracket ("[2, 4]",
 * "[1, 2, 4, 24]") rather than one bracket per ref ("[2][4]") — a real,
 * observed model behavior, not a hypothetical — and the old regex
 * (`/\[(\d+)\]/g`) requires a bracket's entire contents to be a single
 * run of digits, so it silently matched nothing at all for those answers.
 * The model was citing correctly; extraction just couldn't parse the
 * format it happened to use. This accepts either style: a bracket holding
 * one or several comma-separated numbers.
 */
export function extractCitedChunkIds(text: string, contextChunks: RetrievedChunk[]): string[] {
  const citedRefs = new Set<number>();
  for (const bracket of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const num of bracket[1].split(',')) {
      const ref = Number(num.trim());
      if (Number.isFinite(ref)) citedRefs.add(ref);
    }
  }
  return [...citedRefs].map((ref) => contextChunks[ref - 1]?.id).filter((id): id is string => Boolean(id));
}

/**
 * Shared by every LLMProvider's condenseQuestion() — one prompt, so a
 * follow-up gets rewritten the same way regardless of which model answers.
 * Deliberately terse instructions plus an explicit "return ONLY the
 * question" — this is a single-shot, unsupervised completion with no
 * system/user role separation to lean on for compliance the way
 * generateAnswer has CHAT_SYSTEM_PROMPT, so the instruction has to carry
 * the whole weight itself. sanitizeCondensedQuestion below is what
 * actually protects against the model not fully complying.
 */
export function buildCondensePrompt(history: ChatTurn[], question: string): string {
  const historyText = history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n');
  return `Given this conversation history and a follow-up question, rewrite the follow-up as a standalone question that contains all the context needed to understand it without the history — resolve pronouns and implicit references (e.g. "it", "that", "what about X") into the actual subject being discussed. When more than one thing has been discussed, resolve to the MOST RECENT and MOST SPECIFIC one — the subject of the last exchange, not a broader topic mentioned earlier just because it's also in the history. For example, if the history moves from a project to one specific award that project won, "tell me more about it" means the award, not the project, even though the project was mentioned first and more often. If the follow-up is already standalone, return it completely unchanged. Reply with ONLY the rewritten question — no preamble, no quotes, no explanation, nothing else.

Conversation history:
${historyText}

Follow-up question: ${question}

Standalone question:`;
}

/**
 * Defensive post-processing against a model that didn't fully follow
 * buildCondensePrompt's "return ONLY the question" instruction — confirmed
 * worth having, not hypothetical: real single-shot completions from every
 * provider family occasionally add a label ("Standalone question: ..."),
 * wrap the answer in quotes, or add a trailing explanation on a second
 * line. Falls back to the original, un-condensed question — never throws,
 * never returns empty — so a malformed rewrite degrades to "retrieval
 * behaves like it did before this feature existed" rather than breaking
 * retrieval outright.
 */
export function sanitizeCondensedQuestion(raw: string, original: string): string {
  let text = raw.trim();
  text = text.replace(/^(standalone question|rewritten question|rewrite)\s*:\s*/i, '');
  text = (text.split('\n')[0] ?? '').trim();
  text = text.replace(/^["']|["']$/g, '').trim();
  // Empty, or implausibly long for a single question — a sign the model
  // ignored the "ONLY the question" instruction and this is a fragment of
  // something else — both fall back rather than risk embedding garbage.
  if (!text || text.length > 500) return original;
  return text;
}
