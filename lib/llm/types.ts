import type { RetrievedChunk } from '@/lib/db/queries/chunks';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type DocumentSummary = { name: string; description: string | null };

/**
 * Swap point #2 of 3 (with EmbeddingProvider and StorageProvider). Which
 * concrete provider is active is chosen by LLM_PROVIDER in lib/config.ts,
 * via the factory in index.ts.
 */
export type GenerateAnswerParams = {
  systemPrompt: string;
  contextChunks: RetrievedChunk[];
  conversationHistory: ChatTurn[];
  question: string;
  // Document *names/descriptions* the caller is cleared to see — same
  // clearance filter as contextChunks, just metadata instead of content.
  // Lets the model answer "how many documents do you have" honestly
  // without conflating it with content-retrieval (see
  // lib/rag/chat.ts and GENERAL_ASSISTANT_SYSTEM_PROMPT).
  documentInventory?: DocumentSummary[];
};

export interface LLMProvider {
  generateAnswer(params: GenerateAnswerParams): Promise<{ text: string; citedChunkIds: string[] }>;

  // Same request, but yields raw text deltas as they arrive instead of
  // waiting for the full answer — what lets the chat UI render tokens as
  // they're generated rather than staring at "Reading your authorized
  // documents…" for however long the full answer takes. Citation extraction
  // (extractCitedChunkIds) needs the complete text — refs like "[3]" can be
  // split across delta boundaries — so it's deliberately NOT done per-chunk
  // here; the caller (lib/rag/chat.ts::streamAnswer) accumulates the full
  // text from these deltas and extracts citations once streaming ends.
  generateAnswerStream(params: GenerateAnswerParams): AsyncGenerator<string, void, void>;
}
