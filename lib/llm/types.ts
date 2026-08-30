import type { RetrievedChunk } from '@/lib/db/queries/chunks';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type DocumentSummary = { name: string; description: string | null };

/**
 * Swap point #2 of 3 (with EmbeddingProvider and StorageProvider). Which
 * concrete provider is active is chosen by LLM_PROVIDER in lib/config.ts,
 * via the factory in index.ts.
 */
export interface LLMProvider {
  generateAnswer(params: {
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
  }): Promise<{ text: string; citedChunkIds: string[] }>;
}
