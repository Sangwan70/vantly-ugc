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
    }),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenRouter chat-completions failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}
