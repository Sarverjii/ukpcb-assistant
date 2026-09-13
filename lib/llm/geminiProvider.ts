import { FinishReason, GoogleGenAI } from '@google/genai';
import type { ChatTurn, GenerateAnswerParams, LLMProvider } from '@/lib/llm/types';
import {
  buildCondensePrompt,
  buildGeneralKnowledgeFallbackPrompt,
  buildUserTurn,
  extractCitedChunkIds,
  sanitizeCondensedQuestion,
  sanitizeGeneralKnowledgeFallback,
} from '@/lib/llm/shared';

// Free-tier Google Gemini — genuinely $0 (Google's free tier, not a trial
// credit that expires) and, unlike the local Ollama provider, a plain
// hosted API call: no local RAM/compute needed, so this also works on tiny
// free web-hosting tiers (Render's free 512MB service, etc.) where Ollama
// physically cannot run. See README for the full provider comparison.
//
// IMPORTANT: only works while no billing account is attached to the Google
// Cloud project holding this API key — enabling billing switches the whole
// project to paid, even for what would otherwise be free-tier calls.
//
// Constructed fresh by lib/llm/index.ts on every getLLMProvider() call with
// whichever credentials are currently active (DB-configured via Admin -> AI
// Models, or the GEMINI_API_KEY/GEMINI_MODEL/GEMINI_FALLBACK_MODEL env vars
// as a fallback — see that file) — apiKey/model/fallbackModel are
// constructor params, not read from lib/config.ts directly, since the
// active credential can change between requests without a redeploy.

// Thrown when the requested model itself is unavailable — either
// overloaded (503, after retries) or its OWN quota is exhausted (429; Gemini
// meters free-tier quota per model, not per key/account, so a 429 on the
// primary model says nothing about whether a fallback model — a different
// model — has quota left. Confirmed directly: this app hit a real 429 on
// gemini-flash-latest during testing while gemini-flash-lite-latest kept
// working fine on the same key). generateAnswer() below is the one place
// this is caught, to retry with the fallback model. A 401/403 is NOT
// wrapped in this — an actual auth failure is about the key/account, not
// the model, so it would fail identically on the fallback and should
// surface immediately instead of doubling the latency of an already-broken
// request.
class GeminiModelUnavailableError extends Error {}

type GeminiContent = { role: string; parts: { text: string }[] };

// Gemini uses "model" (not "assistant") for the AI turn role. Shared by both
// generateAnswer and generateAnswerStream so the two request shapes can
// never silently drift apart.
function buildContents({
  contextChunks,
  conversationHistory,
  question,
  documentInventory,
}: GenerateAnswerParams): GeminiContent[] {
  const userTurn = buildUserTurn(contextChunks, question, documentInventory);
  return [
    ...conversationHistory.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
    { role: 'user', parts: [{ text: userTurn }] },
  ];
}

export class GeminiLLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModel: string | undefined;
  private client: GoogleGenAI | null = null;

  constructor(options: { apiKey: string; model: string; fallbackModel?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fallbackModel = options.fallbackModel;
  }

  private getClient(): GoogleGenAI {
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generateAnswer(params: GenerateAnswerParams) {
    const { systemPrompt, contextChunks } = params;
    const contents = buildContents(params);

    // Try the configured model first; if — and only if — the primary model
    // itself turns out to be unavailable (overloaded, or its own quota is
    // exhausted) after callWithRetry's own retries, fall back to
    // fallbackModel when one is set, rather than failing the whole
    // request. Confirmed via repeated direct testing that gemini-flash-
    // latest's free-tier capacity/quota can be unavailable for stretches at
    // a time (persistent 503s in one run, a 429 in another — not a one-off
    // blip either way) — this is what lets you point the primary model at
    // the stronger model and still get a reliable app, instead of choosing
    // one extreme or the other.
    try {
      const text = await this.callWithRetry(contents, systemPrompt, this.model);
      return { text, citedChunkIds: extractCitedChunkIds(text, contextChunks) };
    } catch (err) {
      if (err instanceof GeminiModelUnavailableError && this.fallbackModel) {
        // Visible in server logs on purpose — this is the one signal that
        // the primary model is currently unreliable, worth noticing over
        // time rather than silently masking it every single request.
        console.warn(`[gemini] ${err.message} Falling back to "${this.fallbackModel}".`);
        const text = await this.callWithRetry(contents, systemPrompt, this.fallbackModel);
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
      const response = await this.getClient().models.generateContent({
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
        throw new Error('Gemini API authentication failed — check the saved API key.');
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

  // Streaming counterpart of generateAnswer/callWithRetry. Same
  // primary-then-fallback-model story, but no local 503-retry-with-backoff
  // loop before the fallback kicks in: once a single token has reached the
  // client there's no way to "retry" without duplicating output, so this
  // only ever attempts a clean model switch, and only while nothing has
  // streamed yet.
  async *generateAnswerStream(params: GenerateAnswerParams): AsyncGenerator<string, void, void> {
    const contents = buildContents(params);
    try {
      yield* this.streamWithModel(contents, params.systemPrompt, this.model);
    } catch (err) {
      if (err instanceof GeminiModelUnavailableError && this.fallbackModel) {
        console.warn(`[gemini] ${err.message} Falling back to "${this.fallbackModel}" (stream).`);
        yield* this.streamWithModel(contents, params.systemPrompt, this.fallbackModel);
        return;
      }
      throw err;
    }
  }

  private async *streamWithModel(
    contents: GeminiContent[],
    systemPrompt: string,
    model: string,
  ): AsyncGenerator<string, void, void> {
    let stream: Awaited<ReturnType<GoogleGenAI['models']['generateContentStream']>>;
    try {
      stream = await this.getClient().models.generateContentStream({
        model,
        contents,
        config: { systemInstruction: systemPrompt, temperature: 0 },
      });
    } catch (err) {
      // Failure before a single chunk arrived — safe to map to
      // GeminiModelUnavailableError so the caller can still fall back to a
      // different model with nothing lost.
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        throw new Error('Gemini API authentication failed — check the saved API key.');
      }
      if (status === 429) {
        throw new GeminiModelUnavailableError(`Gemini model "${model}" hit its free-tier rate limit.`);
      }
      if (status === 503) {
        throw new GeminiModelUnavailableError(`Gemini model "${model}" is temporarily overloaded.`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }

    // A failure from here on happens after tokens may already have reached
    // the client — deliberately NOT wrapped as GeminiModelUnavailableError,
    // since falling back to a second model at this point would restart the
    // answer from scratch after the user has already seen a partial one.
    for await (const chunk of stream) {
      if (chunk.text) yield chunk.text;
    }
  }

  // Deliberately no retry/fallback-model machinery here, unlike
  // generateAnswer/callWithRetry — this is a best-effort retrieval
  // optimization with its own one-level-up fallback (see
  // lib/rag/chat.ts::buildRetrievalQuery, which falls back to the raw
  // question on any error from this method), so a second retry layer here
  // would only add latency to an already-handled failure case.
  async condenseQuestion(history: ChatTurn[], question: string): Promise<string> {
    const response = await this.getClient().models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: buildCondensePrompt(history, question) }] }],
      config: { temperature: 0 },
    });
    return sanitizeCondensedQuestion(response.text ?? '', question);
  }

  // Same "lightweight, no retry" reasoning as condenseQuestion above — this
  // only ever runs after the main answer call already returned the bare
  // fallback (see lib/rag/chat.ts), so a failure here just means the caller
  // keeps that bare fallback rather than getting a continuation; not worth
  // a second retry layer for a purely additive enhancement.
  async generalKnowledgeFallback(question: string): Promise<string | null> {
    const response = await this.getClient().models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: buildGeneralKnowledgeFallbackPrompt(question) }] }],
      config: { temperature: 0 },
    });
    return sanitizeGeneralKnowledgeFallback(response.text ?? '');
  }

  // See LLMProvider.transcribeImage's own comment. A short, local 503-retry
  // (measured: Gemini's free tier occasionally 503s under demand — same
  // reasoning as callWithRetry above) but deliberately no fallback-model
  // switch: unlike a chat answer, a bad OCR transcription doesn't need a
  // "smarter model" rescue, and the pipeline's own multi-pass budget
  // (pipeline.ts's PASS_BUDGET_MS) already tolerates one page failing
  // without losing the rest of the document.
  //
  // A second, separate failure mode: Gemini can refuse to transcribe a
  // scanned page verbatim if it recognizes the text as matching something
  // already published elsewhere (finishReason "RECITATION"/"SAFETY", empty
  // content, no exception thrown) — confirmed directly against a real
  // scanned government order whose text is also posted on
  // greentribunal.gov.in: verbatim transcription is blocked every time,
  // regardless of temperature. Two escalating fallbacks, confirmed directly
  // against real documents rather than assumed:
  //   1. RECITATION_FALLBACK_PROMPT, same model — works for most blocked
  //      pages, but NOT all: a second real document (Uttarakhand River
  //      Rejuvenation Committee minutes) was blocked on THIS fallback too,
  //      on gemini-flash-lite-latest specifically.
  //   2. The SAME fallback prompt, but on OCR_ESCALATION_MODEL — confirmed
  //      directly on that exact second document: identical prompt,
  //      gemini-flash-latest (not -lite) succeeded where -lite was
  //      blocked. NOT this.fallbackModel: that constructor option exists
  //      for generateAnswer's own primary-then-fallback logic, but nothing
  //      in this app actually populates it (getLLMProvider() only ever
  //      passes apiKey/model — there is no fallback-model column on
  //      AIProviderCredential at all), so relying on it here would make
  //      this entire tier permanently dead code. OCR_ESCALATION_MODEL is
  //      hardcoded and self-contained instead, skipped only if the active
  //      model already IS that model (nothing to escalate to).
  // recitationAttempt tracks this escalation (0/1/2) independently of
  // `attempt` (503 retry count) below — they used to share one counter,
  // which would have made a 503 mid-escalation quietly cut off further
  // recitation retries.
  async transcribeImage(imageBuffer: Buffer, mimeType: string, prompt: string, attempt = 0, recitationAttempt = 0): Promise<string> {
    const canEscalateModel = this.model !== OCR_ESCALATION_MODEL;
    const model = recitationAttempt >= 2 && canEscalateModel ? OCR_ESCALATION_MODEL : this.model;
    try {
      const response = await this.getClient().models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBuffer.toString('base64') } }],
          },
        ],
        config: { temperature: 0 },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (isBlockedFinish(finishReason) && recitationAttempt === 0) {
        console.warn(`[gemini] transcribeImage blocked (${finishReason}) on ${model} — retrying with a rephrased prompt.`);
        return this.transcribeImage(imageBuffer, mimeType, RECITATION_FALLBACK_PROMPT, attempt, recitationAttempt + 1);
      }
      if (isBlockedFinish(finishReason) && recitationAttempt === 1 && canEscalateModel) {
        console.warn(`[gemini] transcribeImage still blocked (${finishReason}) on ${model} — retrying on "${OCR_ESCALATION_MODEL}".`);
        return this.transcribeImage(imageBuffer, mimeType, prompt, attempt, recitationAttempt + 1);
      }
      return response.text ?? '';
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 503 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return this.transcribeImage(imageBuffer, mimeType, prompt, attempt + 1, recitationAttempt);
      }
      if (status === 401 || status === 403) {
        throw new Error('Gemini API authentication failed — check the saved API key.');
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

// finishReason values covering both of Gemini's ways of refusing to
// reproduce recognized/published text: "RECITATION" (its dedicated
// copyright-similarity check) and, seen in testing to carry the exact same
// meaning for this same kind of content, "SAFETY".
function isBlockedFinish(finishReason: FinishReason | undefined): boolean {
  return finishReason === FinishReason.RECITATION || finishReason === FinishReason.SAFETY;
}

// The second-tier RECITATION escalation model — see transcribeImage's own
// comment for why this is hardcoded rather than reusing the (never
// actually populated) fallbackModel constructor option. A real "lite"
// model was confirmed directly to block a page this full model does not,
// on the identical prompt — Gemini's recitation check appears stricter on
// the lite tier. Never itself the primary model for a paying/free-tier
// setup deliberately using -lite, so this only ever fires on the rare
// page that needs it, not as a blanket quality upgrade for every page.
const OCR_ESCALATION_MODEL = 'gemini-flash-latest';

// Sent verbatim as the fallback OCR prompt only when the caller's own
// (normally verbatim-transcription) prompt gets blocked — see
// transcribeImage's own comment for the two-tier escalation this is part
// of. Deliberately NOT phrased as "summarize" or "paraphrase" — an earlier
// version using that framing was ITSELF blocked on a second real document,
// on the same model, with the exact same finishReason. This wording
// (describe for a search index, explicit "never quote more than 5
// consecutive words") was confirmed directly to get past the block on
// BOTH documents this exists to handle, producing accurate, complete
// results each time — reframing the task away from "reproduce this text"
// entirely, rather than just softening the reproduction request, is what
// actually makes the difference.
const RECITATION_FALLBACK_PROMPT =
  'You are indexing this document image for a search engine. Describe its contents in your own words: ' +
  'what kind of document is this, who is it from/about, what dates and names appear, and what topics ' +
  'does it cover. Write 3-5 sentences per page of content. Never quote more than 5 consecutive words directly.';
