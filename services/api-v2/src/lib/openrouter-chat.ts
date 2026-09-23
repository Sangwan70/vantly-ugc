// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * OpenRouter's OpenAI-compatible chat-completions endpoint
 * (https://openrouter.ai/api/v1/chat/completions) -- used ONLY by the
 * podcast/storybook draft writers' free-model path (assist-compose.ts).
 *
 * Why a separate client from lib/anthropic-client.ts's callAnthropicMessages:
 * that one calls OpenRouter's Anthropic-Messages-API-compatible endpoint
 * (/api/v1/messages), which OpenRouter's own docs describe as only
 * guaranteed to work with the Anthropic first-party provider -- i.e. Claude
 * models. A free OpenRouter model (Llama, Gemini, DeepSeek, Nemotron, etc.)
 * is not a Claude model, so routing it through /api/v1/messages is
 * unsupported and has been reported to fail or behave unreliably (this is
 * also the endpoint every other call in this service uses, all pinned to
 * one free model in production via OPENROUTER_MODEL -- plausibly a real
 * contributor to the draft-podcast/draft-storybook timeouts chased in
 * recent commits, not just an undersized token/time budget). OpenRouter's
 * native, fully-supported way to call ANY model, including every free one,
 * is its OpenAI-compatible /api/v1/chat/completions endpoint instead --
 * that's what this file wraps.
 *
 * Env: reuses OPENROUTER_API_KEY, the same credential callAnthropicMessages
 * already requires when MODEL_PROVIDER=openrouter.
 */

export class OpenRouterNotConfiguredError extends Error {
  constructor() {
    super('OPENROUTER_API_KEY is not set');
    this.name = 'OpenRouterNotConfiguredError';
  }
}

export interface ChatCompletionParams {
  /** OpenRouter model slug, e.g. "deepseek/deepseek-v4-flash-0731:free".
   *  Used exactly as given -- this endpoint is never subject to
   *  OPENROUTER_MODEL's pin-every-call override (that override only
   *  applies to lib/anthropic-client.ts's resolveModel), which is the
   *  point: draft-podcast/draft-storybook pick their own free models
   *  deliberately and that choice should not be silently overridden. */
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
}

/**
 * Returns the assistant's raw text reply. Throws (a plain Error, or
 * whatever AbortSignal.timeout() throws on abort -- callers detect that
 * with assist.ts's isTimeoutError, same as callAnthropicMessages callers
 * do) on any non-2xx or a response with no message content.
 */
export async function callOpenRouterChatCompletion(
  params: ChatCompletionParams,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterNotConfiguredError();

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.userMessage },
      ],
      // Free reasoning-capable models (nemotron/qwen/etc.) spend from the
      // SAME max_tokens budget as the visible answer -- OpenRouter's own
      // docs: "the request's max_tokens limit applies to reasoning and
      // visible output combined." A model that reasons at its default
      // effort can burn the entire budget before ever writing the
      // <characters>/<scenes> tags, coming back with an empty/unknown-
      // finish-reason response -- exactly the "AI writer returned an empty
      // response" users kept seeing. We used to cap this with `effort:
      // 'low'`, but that string isn't valid for every model (OpenRouter
      // rejects or silently reinterprets an effort level outside a given
      // model's own supported_efforts list -- e.g. nemotron-3-ultra only
      // accepts 'high'/'medium', not 'low'), so a model swap could silently
      // break the cap again. `reasoning.max_tokens` is the model-agnostic
      // form instead: OpenRouter's docs confirm it works directly for
      // token-budget models and is converted to the nearest effort tier for
      // effort-only models, so it holds up across whichever free model is
      // configured. Reserve at most a third of the call's budget for
      // reasoning (floor 200, so tiny budgets still get SOME thinking room)
      // and leave the rest for the actual answer. `exclude: true` keeps any
      // reasoning that does happen out of `message.content` on providers
      // that would otherwise inline it there.
      reasoning: { max_tokens: Math.max(200, Math.round(params.maxTokens / 3)), exclude: true },
    }),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenRouter chat-completions failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    // Surface WHY it's empty instead of returning '' silently -- this throws,
    // so it flows through the caller's existing primary/fallback retry +
    // captureAiRouteFailure path (assist-compose.ts) instead of being
    // swallowed as an unremarkable "empty result" with zero server-side
    // trace, which is what made this failure mode undiagnosable before.
    const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    const completionTokens = data.usage?.completion_tokens;
    throw new Error(
      `OpenRouter model ${params.model} returned empty content (finish_reason=${finishReason}` +
        (reasoningTokens != null ? `, reasoning_tokens=${reasoningTokens}/${completionTokens ?? '?'}` : '') +
        `) -- likely spent its whole max_tokens budget reasoning before writing an answer`,
    );
  }
  return content;
}
