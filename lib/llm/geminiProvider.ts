import { GoogleGenAI } from '@google/genai';
import { config } from '@/lib/config';
import type { LLMProvider } from '@/lib/llm/types';
import { buildUserTurn, extractCitedChunkIds } from '@/lib/llm/shared';

// Free-tier Google Gemini — genuinely $0 (Google's free tier, not a trial
// credit that expires) and, unlike the local Ollama provider, a plain
// hosted API call: no local RAM/compute needed, so this also works on tiny
// free web-hosting tiers (Render's free 512MB service, etc.) where Ollama
// physically cannot run. See README for the full provider comparison.
//
// IMPORTANT: only works while no billing account is attached to the Google
// Cloud project holding this API key — enabling billing switches the whole
// project to paid, even for what would otherwise be free-tier calls.

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!config.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey, ' +
        'or set LLM_PROVIDER to "ollama" or "anthropic" instead.',
    );
  }
  client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

// Thrown when the requested model itself is unavailable — either
// overloaded (503, after retries) or its OWN quota is exhausted (429; Gemini
// meters free-tier quota per model, not per key/account, so a 429 on
// GEMINI_MODEL says nothing about whether GEMINI_FALLBACK_MODEL — a
// different model — has quota left. Confirmed directly: this app hit a real
// 429 on gemini-flash-latest during testing while gemini-flash-lite-latest
// kept working fine on the same key). generateAnswer() below is the one
// place this is caught, to retry with GEMINI_FALLBACK_MODEL. A 401/403 is
// NOT wrapped in this — an actual auth failure is about the key/account,
// not the model, so it would fail identically on the fallback and should
// surface immediately instead of doubling the latency of an already-broken
// request.
class GeminiModelUnavailableError extends Error {}

export class GeminiLLMProvider implements LLMProvider {
  async generateAnswer({
    systemPrompt,
    contextChunks,
    conversationHistory,
    question,
    documentInventory,
  }: Parameters<LLMProvider['generateAnswer']>[0]) {
    const userTurn = buildUserTurn(contextChunks, question, documentInventory);

    // Gemini uses "model" (not "assistant") for the AI turn role.
    const contents = [
      ...conversationHistory.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content }],
      })),
      { role: 'user', parts: [{ text: userTurn }] },
    ];

    // Try the configured model first; if — and only if — GEMINI_MODEL
    // itself turns out to be unavailable (overloaded, or its own quota is
    // exhausted) after callWithRetry's own retries, fall back to
    // GEMINI_FALLBACK_MODEL when one is set, rather than failing the whole
    // request. Confirmed via repeated direct testing that gemini-flash-
    // latest's free-tier capacity/quota can be unavailable for stretches at
    // a time (persistent 503s in one run, a 429 in another — not a one-off
    // blip either way) — this is what lets you point GEMINI_MODEL at the
    // stronger model and still get a reliable app, instead of choosing one
    // extreme or the other.
    try {
      const text = await this.callWithRetry(contents, systemPrompt, config.GEMINI_MODEL);
      return { text, citedChunkIds: extractCitedChunkIds(text, contextChunks) };
    } catch (err) {
      if (err instanceof GeminiModelUnavailableError && config.GEMINI_FALLBACK_MODEL) {
        // Visible in server logs on purpose — this is the one signal that
        // GEMINI_MODEL is currently unreliable, worth noticing over time
        // rather than silently masking it every single request.
        console.warn(`[gemini] ${err.message} Falling back to "${config.GEMINI_FALLBACK_MODEL}".`);
        const text = await this.callWithRetry(contents, systemPrompt, config.GEMINI_FALLBACK_MODEL);
        return { text, citedChunkIds: extractCitedChunkIds(text, contextChunks) };
      }
      throw err;
    }
  }

  // The free tier occasionally returns 503 ("model overloaded") under
  // demand spikes — this is infra flakiness, not a real failure, so it's
  // worth one short retry before surfacing an error to the user.
  private async callWithRetry(
    contents: { role: string; parts: { text: string }[] }[],
    systemPrompt: string,
    model: string,
    attempt = 0,
  ): Promise<string> {
    try {
      const response = await getClient().models.generateContent({
        model,
        contents,
        // Was 0.2. This app needs consistent rule-following (does this
        // chunk answer the question? is this a meta- or content-question?)
        // far more than varied prose — measured 2 refusals out of 3 runs of
        // the exact same question with the exact same context at 0.2, where
        // the answer was sitting right there in <context> each time. 0
        // trades away any creative variation for the most deterministic
        // reading of CHAT_SYSTEM_PROMPT's rules the model can produce; it
        // doesn't fix a genuine capability gap (see the model's own
        // real-vs-lite tier tradeoffs), just removes gratuitous randomness
        // that was never earning anything here.
        config: { systemInstruction: systemPrompt, temperature: 0 },
      });
      return response.text ?? '';
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 503 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return this.callWithRetry(contents, systemPrompt, model, attempt + 1);
      }
      if (status === 401 || status === 403) {
        throw new Error('Gemini API authentication failed — check GEMINI_API_KEY.');
      }
      if (status === 429) {
        throw new GeminiModelUnavailableError(`Gemini model "${model}" hit its free-tier rate limit.`);
      }
      if (status === 503) {
        throw new GeminiModelUnavailableError(`Gemini model "${model}" is temporarily overloaded.`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
