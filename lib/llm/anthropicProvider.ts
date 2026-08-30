import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import type { LLMProvider } from '@/lib/llm/types';
import { buildUserTurn, extractCitedChunkIds } from '@/lib/llm/shared';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Set LLM_PROVIDER=ollama to use the free local model instead, ' +
        'or add a real Anthropic API key to switch to Claude.',
    );
  }
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export class AnthropicLLMProvider implements LLMProvider {
  async generateAnswer({
    systemPrompt,
    contextChunks,
    conversationHistory,
    question,
    documentInventory,
  }: Parameters<LLMProvider['generateAnswer']>[0]) {
    const userTurn = buildUserTurn(contextChunks, question, documentInventory);

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: userTurn },
    ];

    let response: Anthropic.Message;
    try {
      response = await getClient().messages.create({
        model: config.ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        // Grounded, retrieval-based QA over a handful of short chunks isn't
        // hard reasoning — low effort keeps latency/cost down without a
        // meaningful quality tradeoff for this workload. Raise this if
        // answers on harder synthesis questions need more depth.
        output_config: { effort: 'low' },
        // This app needs consistent rule-following (which of several
        // possible chunks answers the question? is this a meta- or
        // content-question?) far more than varied prose — see the matching
        // comment in geminiProvider.ts for measured evidence (2/4 identical
        // runs gave different answers at a nonzero temperature on the same
        // question with the same context) that motivated setting every
        // provider to 0 here, not just Gemini's.
        temperature: 0,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error('Anthropic API authentication failed — check ANTHROPIC_API_KEY.');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error('Anthropic API rate limit hit — please retry shortly.');
      }
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${err.status}): ${err.message}`);
      }
      throw err;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return { text, citedChunkIds: extractCitedChunkIds(text, contextChunks) };
  }
}
