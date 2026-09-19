// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Provider-agnostic web-search client for the podcast/storybook AI-draft
 * endpoints (POST /v1/assist/draft-podcast, /v1/assist/draft-storybook) —
 * lets the draft writer ground a topic/premise in real, current
 * information instead of only the model's training data.
 *
 * No web-search provider existed anywhere in this codebase before this —
 * this is new integration surface. Deliberately abstracted behind ONE
 * `webSearch()` call and a single WEB_SEARCH_PROVIDER switch (rather than
 * committing to one vendor) because the operator picks whichever of
 * Tavily / Serper.dev / Exa they already have a key for; adding a fourth
 * provider later only means one more case in dispatch + one more request
 * builder, nothing downstream changes.
 *
 * Env:
 *   WEB_SEARCH_PROVIDER  - 'tavily' | 'serper' | 'exa' (unset = feature
 *                           disabled — callers get WebSearchNotConfiguredError
 *                           and should degrade gracefully, not fail the
 *                           whole draft)
 *   TAVILY_API_KEY       - required when WEB_SEARCH_PROVIDER=tavily
 *   SERPER_API_KEY        - required when WEB_SEARCH_PROVIDER=serper
 *   EXA_API_KEY           - required when WEB_SEARCH_PROVIDER=exa
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchNotConfiguredError extends Error {
  constructor(message = 'web search is not configured (set WEB_SEARCH_PROVIDER + the matching API key)') {
    super(message);
    this.name = 'WebSearchNotConfiguredError';
  }
}

export class WebSearchFailedError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
    this.name = 'WebSearchFailedError';
  }
}

const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 5;

type Provider = 'tavily' | 'serper' | 'exa';

function activeProvider(): Provider | null {
  const p = (process.env.WEB_SEARCH_PROVIDER ?? '').trim().toLowerCase();
  if (p === 'tavily' || p === 'serper' || p === 'exa') return p;
  return null;
}

async function searchTavily(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new WebSearchNotConfiguredError('WEB_SEARCH_PROVIDER=tavily but TAVILY_API_KEY is not set');
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic', include_answer: false }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new WebSearchFailedError(`Tavily search failed (${resp.status})`, resp.status >= 400 && resp.status < 500 ? 400 : 502);
  }
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url ?? '', url: r.url ?? '', snippet: (r.content ?? '').slice(0, 600) }));
}

async function searchSerper(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new WebSearchNotConfiguredError('WEB_SEARCH_PROVIDER=serper but SERPER_API_KEY is not set');
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new WebSearchFailedError(`Serper search failed (${resp.status})`, resp.status >= 400 && resp.status < 500 ? 400 : 502);
  }
  const data = (await resp.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.organic ?? [])
    .filter((r) => r.link)
    .slice(0, maxResults)
    .map((r) => ({ title: r.title ?? r.link ?? '', url: r.link ?? '', snippet: (r.snippet ?? '').slice(0, 600) }));
}

async function searchExa(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new WebSearchNotConfiguredError('WEB_SEARCH_PROVIDER=exa but EXA_API_KEY is not set');
  const resp = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, numResults: maxResults, contents: { text: { maxCharacters: 600 } } }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new WebSearchFailedError(`Exa search failed (${resp.status})`, resp.status >= 400 && resp.status < 500 ? 400 : 502);
  }
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url ?? '', url: r.url ?? '', snippet: (r.text ?? '').slice(0, 600) }));
}

/**
 * Run a web search with whichever provider is configured. Throws
 * WebSearchNotConfiguredError when no provider/key is set (the expected
 * state until the operator adds one) — callers should catch that
 * specifically and just skip search rather than failing the draft.
 */
export async function webSearch(query: string, opts?: { maxResults?: number }): Promise<WebSearchResult[]> {
  const provider = activeProvider();
  if (!provider) throw new WebSearchNotConfiguredError();
  const maxResults = Math.max(1, Math.min(10, opts?.maxResults ?? DEFAULT_MAX_RESULTS));
  switch (provider) {
    case 'tavily':
      return searchTavily(query, maxResults);
    case 'serper':
      return searchSerper(query, maxResults);
    case 'exa':
      return searchExa(query, maxResults);
  }
}
