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

  // Rewrites `question` into a standalone, context-complete version using
  // recent conversation history — for embedding/retrieval ONLY. Never
  // shown to the user, never persisted, never sent to generateAnswer as
  // the actual question (see lib/rag/chat.ts::buildRetrievalQuery). A
  // deliberately lightweight single-shot completion, not the full
  // RAG-shaped generateAnswer path — it has no context chunks or document
  // inventory to reason about, just history + one question. The caller is
  // responsible for graceful fallback on failure; this method itself
  // isn't expected to retry or fall back to a second model the way
  // generateAnswer does, since a condensing failure should just mean
  // "retrieve using the raw question" rather than blocking the turn.
  condenseQuestion(history: ChatTurn[], question: string): Promise<string>;

  // Called ONLY after generateAnswer/generateAnswerStream already produced
  // the bare NO_AUTHORIZED_INFO_ANSWER fallback (see lib/rag/chat.ts) — a
  // second, narrowly-scoped judgment call: does this question have a real
  // answer in the outside world, and if so, what is it? Returns null when
  // it doesn't (a purely private company fact with no public equivalent —
  // the caller keeps the bare refusal rather than risk a fabricated-
  // looking answer), or the real answer text otherwise. A deliberately
  // lightweight single-shot completion, same shape as condenseQuestion —
  // not the full RAG-shaped generateAnswer path, since by construction
  // there's no authorized document content relevant to this call at all.
  generalKnowledgeFallback(question: string): Promise<string | null>;

  // OCR for one scanned document page — used only by
  // lib/documents/pipeline.ts, when a PDF page's extracted text comes back
  // empty (a scanned image with no text layer at all, as opposed to a
  // normal PDF's real text layer). Reuses whichever LLM provider is
  // already configured/active for chat rather than a separate "OCR
  // provider" setting — every provider this app supports implements this,
  // since the whole point is that OCR works no matter which of the four
  // Admin -> AI Models providers is currently active. `prompt` is the
  // transcription instruction (see PDF_OCR_PROMPT in pipeline.ts);
  // `imageBuffer`/`mimeType` are the rasterized page. Returns the raw
  // transcribed text — the caller chunks/embeds it exactly like any other
  // extracted text, so a scanned document behaves identically to a normal
  // one everywhere downstream of this call.
  //
  // Quality depends entirely on the active model actually supporting
  // vision. Gemini/OpenAI/Anthropic's mainstream chat models all do; for
  // Ollama specifically, it depends on which model was pulled (llava,
  // qwen2-vl, gemma3, etc. do; a plain text model doesn't) — this app has
  // no way to verify that ahead of time, so a text-only Ollama model will
  // just produce a poor or empty transcription rather than a clear error.
  transcribeImage(imageBuffer: Buffer, mimeType: string, prompt: string): Promise<string>;
}
