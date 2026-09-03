import type { ChatTurn, GenerateAnswerParams, LLMProvider } from '@/lib/llm/types';
import {
  buildCondensePrompt,
  buildGeneralKnowledgeFallbackPrompt,
  buildUserTurn,
  extractCitedChunkIds,
  sanitizeCondensedQuestion,
  sanitizeGeneralKnowledgeFallback,
} from '@/lib/llm/shared';

function buildMessages(params: GenerateAnswerParams) {
  const userTurn = buildUserTurn(params.contextChunks, params.question, params.documentInventory);
  return [
    { role: 'system', content: params.systemPrompt },
    ...params.conversationHistory.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: userTurn },
  ];
}

// Free, local, no API key, no signup — chat via a locally-running Ollama
// server (https://ollama.com). This is the default LLM_PROVIDER for
// dev/testing per the same "free software first" reasoning as the local
// embedding provider. Swap to LLM_PROVIDER=anthropic for Claude once you're
// ready to pay for hosted inference — no other code changes needed.
//
// Requires Ollama installed and running (`ollama serve`, usually automatic),
// with the configured model pulled (`ollama pull <model>`). See README for
// setup. Doesn't work at all on the current Vercel deployment (no
// persistent local network to reach a self-hosted server from) — wired up
// and selectable in Admin -> AI Models regardless, ready for the day this
// app moves to a self-hosted Linux/nginx deployment that can actually reach
// an Ollama server.
//
// Constructed fresh by lib/llm/index.ts on every getLLMProvider() call with
// whichever credentials are currently active (DB-configured via Admin -> AI
// Models, or the OLLAMA_BASE_URL/OLLAMA_MODEL env vars as a fallback — see
// that file) — baseUrl/model are constructor params, not read from
// lib/config.ts directly.

type OllamaChatResponse = {
  message?: { role: string; content: string };
  error?: string;
};

export class OllamaLLMProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: { baseUrl: string; model: string }) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
  }

  async generateAnswer(params: GenerateAnswerParams) {
    const messages = buildMessages(params);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          // See the matching comment in geminiProvider.ts: this app needs
          // consistent rule-following far more than varied prose, and 0.2
          // measurably produced different answers across identical runs.
          options: { temperature: 0 },
        }),
      });
    } catch {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? ` +
          `Start it with \`ollama serve\` (or the desktop app), and make sure ` +
          `\`ollama pull ${this.model}\` has been run at least once.`,
      );
    }

    const data = (await res.json()) as OllamaChatResponse;

    if (!res.ok || data.error) {
      throw new Error(
        `Ollama error: ${data.error ?? res.statusText}. If the model isn't pulled yet, run ` +
          `\`ollama pull ${this.model}\`.`,
      );
    }

    const text = data.message?.content ?? '';
    return { text, citedChunkIds: extractCitedChunkIds(text, params.contextChunks) };
  }

  async *generateAnswerStream(params: GenerateAnswerParams): AsyncGenerator<string, void, void> {
    const messages = buildMessages(params);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          options: { temperature: 0 },
        }),
      });
    } catch {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? ` +
          `Start it with \`ollama serve\` (or the desktop app), and make sure ` +
          `\`ollama pull ${this.model}\` has been run at least once.`,
      );
    }

    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as OllamaChatResponse;
      throw new Error(
        `Ollama error: ${data.error ?? res.statusText}. If the model isn't pulled yet, run ` +
          `\`ollama pull ${this.model}\`.`,
      );
    }

    // Ollama's streaming response is NDJSON — one complete JSON object per
    // line, each carrying an incremental content delta — not SSE, so this
    // reads the raw body and splits on newlines itself rather than using an
    // SSE parser.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as OllamaChatResponse;
          if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
          if (chunk.message?.content) yield chunk.message.content;
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: buildCondensePrompt(history, question) }],
          stream: false,
          options: { temperature: 0 },
        }),
      });
    } catch {
      throw new Error(`Could not reach Ollama at ${this.baseUrl}. Is it running?`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok || data.error) {
      throw new Error(`Ollama error: ${data.error ?? res.statusText}`);
    }
    return sanitizeCondensedQuestion(data.message?.content ?? '', question);
  }

  // See geminiProvider.ts's matching comment — lightweight, no retry; a
  // failure here just means the caller keeps the bare document-gap
  // fallback rather than getting a continuation.
  async generalKnowledgeFallback(question: string): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: buildGeneralKnowledgeFallbackPrompt(question) }],
          stream: false,
          options: { temperature: 0 },
        }),
      });
    } catch {
      throw new Error(`Could not reach Ollama at ${this.baseUrl}. Is it running?`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (!res.ok || data.error) {
      throw new Error(`Ollama error: ${data.error ?? res.statusText}`);
    }
    return sanitizeGeneralKnowledgeFallback(data.message?.content ?? '');
  }
}
