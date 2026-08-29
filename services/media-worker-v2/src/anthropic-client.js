// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared Anthropic Messages API caller, provider-switchable via MODEL_PROVIDER.
 *
 * All three Claude call sites in this service (character-video-pipeline's
 * per-run script writer, v2/persona-brief, v2/selfie-orchestrator) used to
 * each hand-roll an identical `fetch('https://api.anthropic.com/v1/messages')`
 * call. This centralizes that so adding a provider means editing one file.
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

function resolveEndpoint() {
  if (MODEL_PROVIDER === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OPENROUTER_API_KEY missing — required when MODEL_PROVIDER=openrouter');
    }
    return {
      url: 'https://openrouter.ai/api/v1/messages',
      headers: {
        'Content-Type': 'application/json',
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
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  };
}

/**
 * OpenRouter requires provider-prefixed Claude model ids, and
 * OPENROUTER_MODEL (when set) overrides whatever model the call site asked
 * for — lets an operator pin every OpenRouter call to one model (Claude or
 * otherwise) regardless of which model each pipeline step would otherwise
 * request.
 */
function resolveModel(model) {
  if (MODEL_PROVIDER !== 'openrouter') return model;
  const override = (process.env.OPENROUTER_MODEL || '').trim();
  const chosen = override || model;
  return typeof chosen === 'string' && !chosen.includes('/') ? `anthropic/${chosen}` : chosen;
}

/**
 * POST an Anthropic Messages API request through whichever provider
 * MODEL_PROVIDER selects. Returns the raw fetch Response — callers keep
 * their existing `resp.ok` / `resp.json()` / `resp.text()` handling.
 *
 * @param {{model: string, system?: string, messages: unknown[], max_tokens: number, signal?: AbortSignal}} body
 */
export async function callAnthropicMessages({ signal, ...body }) {
  const { url, headers } = resolveEndpoint();
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, model: resolveModel(body.model) }),
    signal,
  });
}

export function currentModelProvider() {
  return MODEL_PROVIDER;
}

/** Whether the credential MODEL_PROVIDER currently needs is set. */
export function hasProviderCredential() {
  return MODEL_PROVIDER === 'openrouter'
    ? !!process.env.OPENROUTER_API_KEY
    : !!process.env.ANTHROPIC_API_KEY;
}

/** Name of the env var MODEL_PROVIDER currently needs, for error messages. */
export function missingCredentialEnvVar() {
  return MODEL_PROVIDER === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
}
