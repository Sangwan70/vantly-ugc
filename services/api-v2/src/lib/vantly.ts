// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared client for our self-hosted Vantly instance's Postiz-based public API
 * (https://vantly.social — a Postiz fork we run ourselves, NOT the commercial
 * platform.postiz.com / api.postiz.com / enterprise-api.postiz.com).
 *
 * This used to be two disconnected things: a per-user "direct API key" path
 * (routes/vantly.ts) and a separate Postiz "Enterprise" multi-tenant client
 * that auto-provisioned a Postiz sub-account per vantly-ugc user. Vantly has
 * no Enterprise-tier API (verified against its actual backend source), but it
 * doesn't need one: every function below is called with a per-user token —
 * either a manually-pasted org API key OR a Vantly OAuth access token (see
 * apps/web/app/api/integrations/postiz/oauth/*) — and Vantly's own
 * PublicAuthMiddleware accepts both raw in the `Authorization` header,
 * resolving straight to that user's own Vantly organization. No userId path
 * segments, no server-side "create a Postiz user" step, no shared budget.
 *
 * Endpoints verified directly against vantly/apps/backend/src source:
 *   - apps/backend/src/public-api/routes/v1/public.integrations.controller.ts
 *   - apps/backend/src/services/auth/public.auth.middleware.ts
 *   - apps/backend/src/api/routes/no.auth.integrations.controller.ts (catalog)
 */

const VANTLY_PUBLIC_API_BASE = (
  process.env.VANTLY_API_BASE_URL || 'https://vantly.social/api/public/v1'
).replace(/\/+$/, '');

const VANTLY_APP_BASE = (process.env.VANTLY_APP_URL || 'https://vantly.social').replace(/\/+$/, '');

async function pfetch(path: string, token: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  return fetch(`${VANTLY_PUBLIC_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      'User-Agent': 'vantly-ugc-vantly/1.0',
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    // Fail fast rather than hang — same defensive timeout the old Enterprise
    // client used, since a stalled upstream shouldn't wedge our own request.
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function pjson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const r = await pfetch(path, token, init);
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`vantly ${path} ${r.status}: ${text.slice(0, 300)}`);
    (err as { status?: number }).status = r.status;
    throw err;
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** A user's own connected social account, from GET /public/v1/integrations. */
export interface VantlyIntegration {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
}

export async function listIntegrations(token: string): Promise<VantlyIntegration[]> {
  return pjson<VantlyIntegration[]>('/integrations', token);
}

/** Static catalog entry — which networks Vantly supports at all (unauthenticated, org-independent). */
export interface VantlyProviderCatalogEntry {
  name: string;
  identifier: string;
  toolTip?: string;
}

// Cache the catalog for an hour — it's static, org-independent metadata, no
// reason to refetch it on every page load.
let _catalogCache: { at: number; data: VantlyProviderCatalogEntry[] } | null = null;
export async function listAvailableProviders(): Promise<VantlyProviderCatalogEntry[]> {
  if (_catalogCache && Date.now() - _catalogCache.at < 3_600_000) {
    return _catalogCache.data;
  }
  // NOT under /public/v1 and NOT authenticated — this is
  // NoAuthIntegrationsController's GET /integrations catalog.
  const resp = await fetch(`${VANTLY_APP_BASE}/api/integrations`, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`vantly provider catalog failed: HTTP ${resp.status} — ${text.slice(0, 300)}`), {
      status: resp.status,
    });
  }
  // IntegrationManager.getAllIntegrations() (vantly/libraries/nestjs-libraries/
  // src/integrations/integration.manager.ts) returns { social: [...], article:
  // [...] }, NOT a bare array — this used to be cast straight to
  // VantlyProviderCatalogEntry[], which made `all.filter is not a function`
  // blow up one level up in routes/v1/social.ts the moment this ran for real.
  const body = (await resp.json()) as { social?: VantlyProviderCatalogEntry[] } | VantlyProviderCatalogEntry[];
  const data = Array.isArray(body) ? body : Array.isArray(body?.social) ? body.social : [];
  _catalogCache = { at: Date.now(), data };
  return data;
}

/**
 * Generate the OAuth connect URL for a provider (tiktok/instagram/x/…) so the
 * user can authorize that specific network.
 *
 * IMPORTANT LIMITATION: unlike the old commercial Enterprise API, this
 * endpoint (GET /public/v1/social/:integration) does not accept a redirect
 * URL — Vantly's own backend decides where the browser lands after the
 * network's OAuth completes, which is somewhere on vantly.social, not back
 * on vantly-ugc-app. Tell the user to come back and hit refresh.
 */
export async function getConnectUrl(token: string, provider: string, refresh?: string): Promise<string> {
  const query = refresh ? `?refresh=${encodeURIComponent(refresh)}` : '';
  const data = await pjson<{ url?: string }>(`/social/${encodeURIComponent(provider)}${query}`, token);
  if (!data.url) throw new Error('social connect returned no url');
  return data.url;
}

export async function deleteIntegration(token: string, integrationId: string): Promise<void> {
  await pjson(`/integrations/${encodeURIComponent(integrationId)}`, token, { method: 'DELETE' });
}

/**
 * Register media with Vantly from a public URL.
 *
 * We use /upload-from-url (NOT multipart /upload): the commercial gateway
 * never forwarded multipart bodies, and Vantly's own controller implements
 * /upload-from-url as a first-class route (see uploadsFromUrl in
 * public.integrations.controller.ts) that fetches the asset itself and
 * returns a path on Vantly's own upload storage — which createPost REQUIRES,
 * since posted media must live on Vantly's own upload domain.
 */
export async function uploadFromUrl(token: string, url: string): Promise<{ id: string; path: string }> {
  const data = await pjson<{ id?: string; path?: string }>('/upload-from-url', token, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  if (!data.id || !data.path) {
    throw new Error(`upload-from-url returned no id/path: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { id: data.id, path: data.path };
}

/** Per-network required `settings` for createPost (verified against the live commercial API; Vantly is the same Postiz DTO shape). */
function networkSettings(network: string): Record<string, unknown> {
  const base = { __type: network };
  // X requires who_can_reply_post; without it the post is rejected.
  if (network === 'x') return { ...base, who_can_reply_post: 'everyone' };
  return base;
}

export interface VantlyPostInput {
  /** Vantly integration (channel) id. */
  integrationId: string;
  /** Network for settings.__type, e.g. "x" / "tiktok" / "instagram". */
  network: string;
  content: string;
  /** Uploaded media — MUST carry both id AND path (from uploadFromUrl). */
  media?: { id: string; path: string }[];
}

export interface VantlyPostResult {
  /** Which requested channel this post landed on. */
  integrationId: string;
  /** Vantly/Postiz post id for that channel's post. */
  postId: string;
}

export interface VantlyCreateResult {
  /** One entry per post Vantly actually created, matched back to the integration that requested it. Empty ⇒ nothing posted. */
  results: VantlyPostResult[];
  /** Raw response, for logging/diagnostics. */
  raw: unknown;
}

/**
 * Schedule (type:'schedule' + date) or publish now (type:'now').
 *
 * The DTO is nested — integration.id, value[].content, value[].image:[{id,
 * path}], settings.__type:<network> — and every request needs date,
 * shortLink AND tags even for type:'now' (Vantly's PostsService rejects a
 * flat/incomplete body, or accepts it but produces an empty post that never
 * reaches the network, so we both send the correct shape AND verify post ids
 * came back).
 */
export async function createPost(
  token: string,
  args: { type: 'now' | 'schedule'; date?: string; posts: VantlyPostInput[] },
): Promise<VantlyCreateResult> {
  const date = args.date ?? new Date().toISOString();
  const raw = await pjson<unknown>('/posts', token, {
    method: 'POST',
    body: JSON.stringify({
      type: args.type,
      date,
      shortLink: false,
      tags: [],
      posts: args.posts.map((p) => ({
        integration: { id: p.integrationId },
        value: [{ content: p.content, image: p.media ?? [] }],
        settings: networkSettings(p.network),
      })),
    }),
  });

  const results = extractPostResults(raw);
  if (results.length === 0) {
    throw new Error(`vantly created no post (empty result): ${JSON.stringify(raw).slice(0, 400)}`);
  }
  return { results, raw };
}

/**
 * Postiz's create-post response is a flat array like [{postId, integration}]
 * — `integration` is the integration/channel id the post was created for
 * (sometimes nested as {id: ...} rather than a bare string, so both shapes
 * are handled). Matching each result back to its integrationId is what lets
 * callers record per-channel status instead of just a raw count.
 */
function extractPostResults(raw: unknown): VantlyPostResult[] {
  const results: VantlyPostResult[] = [];
  const pick = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const postId = rec.postId ?? rec.id;
    const integrationRaw = rec.integration ?? rec.integrationId;
    const integrationId =
      typeof integrationRaw === 'string'
        ? integrationRaw
        : integrationRaw && typeof integrationRaw === 'object'
          ? ((integrationRaw as Record<string, unknown>).id as string | undefined)
          : undefined;
    if (typeof postId === 'string' && postId && typeof integrationId === 'string' && integrationId) {
      results.push({ integrationId, postId });
    }
  };
  if (Array.isArray(raw)) raw.forEach(pick);
  else pick(raw);
  return results;
}

/**
 * List Posts — the only Postiz endpoint that returns per-post delivery
 * status (`state`: QUEUE/PUBLISHED/ERROR/DRAFT) and the platform permalink
 * (`releaseURL`). POST /posts's own response has neither, and Postiz has no
 * lifecycle webhooks (confirmed against its own issue tracker), so this is
 * the only way to resolve a real "view on platform" link after publishing —
 * see resolvePublicationUrlRoute in routes/v1/social.ts, which polls this
 * shortly after a post is created.
 */
export interface VantlyPostStatus {
  id: string;
  state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';
  releaseURL: string | null;
  publishDate: string | null;
}

export async function listPosts(token: string, args: { startDate: string; endDate: string }): Promise<VantlyPostStatus[]> {
  const params = new URLSearchParams({ startDate: args.startDate, endDate: args.endDate });
  const raw = await pjson<unknown>(`/posts?${params.toString()}`, token);
  const arr = Array.isArray(raw) ? raw : ((raw as { posts?: unknown[]; data?: unknown[] } | null)?.posts ?? (raw as { data?: unknown[] } | null)?.data ?? []);
  return (arr as Record<string, unknown>[])
    .map((p) => ({
      id: String(p.id ?? ''),
      state: (typeof p.state === 'string' ? p.state : 'QUEUE') as VantlyPostStatus['state'],
      releaseURL: typeof p.releaseURL === 'string' && p.releaseURL ? p.releaseURL : null,
      publishDate: (typeof p.publishDate === 'string' ? p.publishDate : null),
    }))
    .filter((p) => p.id);
}
