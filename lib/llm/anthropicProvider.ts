import Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn, GenerateAnswerParams, LLMProvider } from '@/lib/llm/types';
import {
  buildCondensePrompt,
  buildGeneralKnowledgeFallbackPrompt,
  buildUserTurn,
  extractCitedChunkIds,
  sanitizeCondensedQuestion,
  sanitizeGeneralKnowledgeFallback,
} from '@/lib/llm/shared';

function buildMessages(params: GenerateAnswerParams): Anthropic.MessageParam[] {
  const userTurn = buildUserTurn(params.contextChunks, params.question, params.documentInventory);
  return [
    ...params.conversationHistory.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: userTurn },
  ];
}

function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Anthropic API authentication failed — check the saved API key.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Anthropic API rate limit hit — please retry shortly.');
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Anthropic API error (${err.status}): ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Constructed fresh by lib/llm/index.ts on every getLLMProvider() call with
// whichever credentials are currently active (DB-configured via Admin -> AI
// Models, or the ANTHROPIC_API_KEY/ANTHROPIC_MODEL env vars as a fallback —
// see that file). Deliberately takes apiKey/model as constructor params
// rather than reading lib/config.ts directly, unlike this file's own
// pre-runtime-switchable-providers history: the active credential can
// change between one request and the next without a redeploy, so nothing
// in this class may read process.env or a module-level cache.
export class AnthropicLLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private client: Anthropic | null = null;

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  private getClient(): Anthropic {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  async generateAnswer(params: GenerateAnswerParams) {
    const messages = buildMessages(params);

    let response: Anthropic.Message;
    try {
      response = await this.getClient().messages.create({
        model: this.model,
        max_tokens: 1024,
        system: params.systemPrompt,
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
      throw mapAnthropicError(err);
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return { text, citedChunkIds: extractCitedChunkIds(text, params.contextChunks) };
  }

  async *generateAnswerStream(params: GenerateAnswerParams): AsyncGenerator<string, void, void> {
    const messages = buildMessages(params);

    // .stream() kicks off the request internally and returns synchronously
    // (it's not itself a Promise) — a connection/auth failure only ever
    // surfaces once iteration starts, not from this call, so there's
    // nothing to try/catch here.
    const stream = this.getClient().messages.stream({
      model: this.model,
      max_tokens: 1024,
      system: params.systemPrompt,
      output_config: { effort: 'low' },
      temperature: 0,
      messages,
    });

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  // See geminiProvider.ts's matching comment — no retry here on purpose,
  // the caller (lib/rag/chat.ts::buildRetrievalQuery) already falls back
  // to the raw question on any failure from this method.
  async condenseQuestion(history: ChatTurn[], question: string): Promise<string> {
    try {
      const response = await this.getClient().messages.create({
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: buildCondensePrompt(history, question) }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return sanitizeCondensedQuestion(text, question);
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  // See geminiProvider.ts's matching comment — lightweight, no retry; a
  // failure here just means the caller keeps the bare document-gap
  // fallback rather than getting a continuation.
  async generalKnowledgeFallback(question: string): Promise<string | null> {
    try {
      const response = await this.getClient().messages.create({
        model: this.model,
        max_tokens: 600,
        temperature: 0,
        messages: [{ role: 'user', content: buildGeneralKnowledgeFallbackPrompt(question) }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return sanitizeGeneralKnowledgeFallback(text);
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}
