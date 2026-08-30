import type { RetrievedChunk } from '@/lib/db/queries/chunks';
import type { DocumentSummary } from '@/lib/llm/types';

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

export function extractCitedChunkIds(text: string, contextChunks: RetrievedChunk[]): string[] {
  const citedRefs = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  return [...new Set(citedRefs)]
    .map((ref) => contextChunks[ref - 1]?.id)
    .filter((id): id is string => Boolean(id));
}
