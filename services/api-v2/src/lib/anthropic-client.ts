// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared Anthropic Messages API caller, provider-switchable via MODEL_PROVIDER.
 *
 * The four Claude call sites in this service (the in-app creative agent,
 * character-storyboard suggestions, schedule-preview script generation,
 * and generate.ts's script writer) each hand-rolled an identical
 * `fetch('https://api.anthropic.com/v1/messages')` call. This centralizes
 * that so adding a provider means editing one file.
 *
 *   MODEL_PROVIDER=anthropic (default): calls api.anthropic.com directly,
 *     authenticating with ANTHROPIC_API_KEY as the x-api-key header.
 *   MODEL_PROVIDER=openrouter: calls OpenRouter's Anthropic-Messages-API-
 *     compatible endpoint (https://openrouter.ai/api/v1/messages) instead,
 *     authenticating with OPENROUTER_API_KEY as a Bearer token, and
 *     prefixing bare Claude model ids with "anthropic/" (OpenRouter's
 *     required model-naming convention, e.g. "anthropic/claude-opus-4-7").
 *
 * Both are the same Messages API request/response shape (system, messages,
 * model, max_tokens -> content[], usage, stop_reason) — only the base URL,
 * auth header, and model id differ, so every existing call site keeps its
 * `data.content.find(...)` response handling unchanged.
 */

const MODEL_PROVIDER = (process.env.MODEL_PROVIDER || 'anthropic').toLowerCase().trim();

function resolveEndpoint(): { url: string; headers: Record<string, string> } {
  if (MODEL_PROVIDER === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OPENROUTER_API_KEY missing — required when MODEL_PROVIDER=openrouter');
    }
    return {
      url: 'https://openrouter.ai/api/v1/messages',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
      },
    };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY missing — required when MODEL_PROVIDER=anthropic (default)');
  }
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  };
}

/**
 * OpenRouter requires provider-prefixed Claude model ids, and
 * OPENROUTER_MODEL (when set) overrides whatever model the call site asked
 * for — lets an operator pin every OpenRouter call to one model (Claude or
 * otherwise) regardless of which model each route would otherwise request.
 */
function resolveModel(model: string): string {
  if (MODEL_PROVIDER !== 'openrouter') return model;
  const override = (process.env.OPENROUTER_MODEL ?? '').trim();
  const chosen = override || model;
  return chosen.includes('/') ? chosen : `anthropic/${chosen}`;
}

export interface AnthropicMessagesBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: unknown[];
  tools?: unknown[];
  [key: string]: unknown;
}

/**
 * POST an Anthropic Messages API request through whichever provider
 * MODEL_PROVIDER selects. Returns the raw fetch Response — callers keep
 * their existing `resp.ok` / `resp.json()` / `resp.text()` handling.
 */
export async function callAnthropicMessages(
  body: AnthropicMessagesBody,
  opts: { signal?: AbortSignal } = {},
): Promise<Response> {
  const { url, headers } = resolveEndpoint();
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, model: resolveModel(body.model) }),
    signal: opts.signal,
  });
}

/** Whether the credential MODEL_PROVIDER currently needs is set. */
export function hasProviderCredential(): boolean {
  return MODEL_PROVIDER === 'openrouter'
    ? !!process.env.OPENROUTER_API_KEY
    : !!process.env.ANTHROPIC_API_KEY;
}

/** Name of the env var MODEL_PROVIDER currently needs, for error messages. */
export function missingCredentialEnvVar(): string {
  return MODEL_PROVIDER === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
}

export function currentModelProvider(): string {
  return MODEL_PROVIDER;
}
