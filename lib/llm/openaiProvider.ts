import type { ChatTurn, GenerateAnswerParams, LLMProvider } from '@/lib/llm/types';
import {
  buildCondensePrompt,
  buildGeneralKnowledgeFallbackPrompt,
  buildUserTurn,
  extractCitedChunkIds,
  sanitizeCondensedQuestion,
  sanitizeGeneralKnowledgeFallback,
} from '@/lib/llm/shared';

// OpenAI's Chat Completions API via plain fetch — no `openai` SDK
// dependency, matching this app's existing pattern for a single JSON/SSE
// endpoint (see ollamaProvider.ts, and lib/embeddings/openaiProvider.ts for
// the embeddings side of the same provider). Constructed fresh by
// lib/llm/index.ts on every getLLMProvider() call with whichever
// credentials are currently active (DB-configured via Admin -> AI Models —
// there is no env-var fallback for this provider; it did not exist before
// the DB-driven configuration feature).
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

type OpenAIChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function buildMessages(params: GenerateAnswerParams): OpenAIChatMessage[] {
  const userTurn = buildUserTurn(params.contextChunks, params.question, params.documentInventory);
  return [
    { role: 'system', content: params.systemPrompt },
    ...params.conversationHistory.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: userTurn },
  ];
}

type OpenAIChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message: string };
};

export class OpenAILLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }

  private async chat(messages: OpenAIChatMessage[], maxTokens: number): Promise<string> {
    let res: Response;
    try {
      res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: this.headers(),
        // temperature 0 — same "consistent rule-following over varied
        // prose" reasoning as every other provider in this app (see
        // geminiProvider.ts's matching comment for the measured evidence).
        body: JSON.stringify({ model: this.model, messages, temperature: 0, max_tokens: maxTokens }),
      });
    } catch {
      throw new Error('Could not reach the OpenAI API — check network connectivity.');
    }
    const data = (await res.json().catch(() => ({}))) as OpenAIChatResponse;
    if (res.status === 401 || res.status === 403) {
      throw new Error('OpenAI API authentication failed — check the saved API key.');
    }
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${data.error?.message ?? res.statusText}`);
    }
    return data.choices?.[0]?.message?.content ?? '';
  }

  async generateAnswer(params: GenerateAnswerParams) {
    const text = await this.chat(buildMessages(params), 1024);
    return { text, citedChunkIds: extractCitedChunkIds(text, params.contextChunks) };
  }

  async *generateAnswerStream(params: GenerateAnswerParams): AsyncGenerator<string, void, void> {
    let res: Response;
    try {
      res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(params),
          temperature: 0,
          max_tokens: 1024,
          stream: true,
        }),
      });
    } catch {
      throw new Error('Could not reach the OpenAI API — check network connectivity.');
    }
    if (!res.ok || !res.body) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('OpenAI API authentication failed — check the saved API key.');
      }
      const data = (await res.json().catch(() => ({}))) as OpenAIChatResponse;
      throw new Error(`OpenAI API error: ${data.error?.message ?? res.statusText}`);
    }

    // Server-Sent Events: "data: {...}\n\n" lines, terminated by
    // "data: [DONE]" — unlike Ollama's NDJSON, this needs to split on
    // blank-line-delimited events, not plain newlines.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '[DONE]') return;
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // See geminiProvider.ts's matching comment — no retry here on purpose,
  // the caller (lib/rag/chat.ts::buildRetrievalQuery) already falls back
  // to the raw question on any failure from this method.
  async condenseQuestion(history: ChatTurn[], question: string): Promise<string> {
    const text = await this.chat([{ role: 'user', content: buildCondensePrompt(history, question) }], 200);
    return sanitizeCondensedQuestion(text, question);
  }

  // See geminiProvider.ts's matching comment — lightweight, no retry; a
  // failure here just means the caller keeps the bare document-gap
  // fallback rather than getting a continuation.
  async generalKnowledgeFallback(question: string): Promise<string | null> {
    const text = await this.chat([{ role: 'user', content: buildGeneralKnowledgeFallbackPrompt(question) }], 600);
    return sanitizeGeneralKnowledgeFallback(text);
  }
}
