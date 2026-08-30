import { config } from '@/lib/config';
import type { LLMProvider } from '@/lib/llm/types';
import { buildUserTurn, extractCitedChunkIds } from '@/lib/llm/shared';

// Free, local, no API key, no signup — chat via a locally-running Ollama
// server (https://ollama.com). This is the default LLM_PROVIDER for
// dev/testing per the same "free software first" reasoning as the local
// embedding provider. Swap to LLM_PROVIDER=anthropic for Claude once you're
// ready to pay for hosted inference — no other code changes needed.
//
// Requires Ollama installed and running (`ollama serve`, usually automatic),
// with the configured model pulled (`ollama pull <OLLAMA_MODEL>`). See
// README for setup.

type OllamaChatResponse = {
  message?: { role: string; content: string };
  error?: string;
};

export class OllamaLLMProvider implements LLMProvider {
  async generateAnswer({
    systemPrompt,
    contextChunks,
    conversationHistory,
    question,
    documentInventory,
  }: Parameters<LLMProvider['generateAnswer']>[0]) {
    const userTurn = buildUserTurn(contextChunks, question, documentInventory);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: userTurn },
    ];

    let res: Response;
    try {
      res = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.OLLAMA_MODEL,
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
        `Could not reach Ollama at ${config.OLLAMA_BASE_URL}. Is it running? ` +
          `Start it with \`ollama serve\` (or the desktop app), and make sure ` +
          `\`ollama pull ${config.OLLAMA_MODEL}\` has been run at least once.`,
      );
    }

    const data = (await res.json()) as OllamaChatResponse;

    if (!res.ok || data.error) {
      throw new Error(
        `Ollama error: ${data.error ?? res.statusText}. If the model isn't pulled yet, run ` +
          `\`ollama pull ${config.OLLAMA_MODEL}\`.`,
      );
    }

    const text = data.message?.content ?? '';
    return { text, citedChunkIds: extractCitedChunkIds(text, contextChunks) };
  }
}
