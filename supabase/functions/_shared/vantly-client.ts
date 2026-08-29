// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Minimal Postiz-protocol Public API client — points at Vantly
 * (https://vantly.social), our self-hosted Postiz fork, by default. The
 * profiles.vantly_api_key value this reads (set by either the manual
 * paste-a-key flow or the Vantly OAuth connect flow — see
 * apps/web/app/api/integrations/postiz/oauth/*) is used identically here as
 * a raw Authorization header, same as services/api-v2/src/lib/postiz.ts.
 *
 * Endpoint:  ${VANTLY_API_BASE_URL env var, default https://vantly.social/api/public/v1}
 * Auth:      Authorization: <api-key>   (raw, not "Bearer")
 * Limits:    30 requests/hour
 *
 * Three operations matter for the auto-publish flow:
 *   1. listIntegrations(apiKey)         GET  /integrations
 *   2. uploadFromUrl(apiKey, url)       POST /upload-from-url
 *   3. createPost(apiKey, params)       POST /posts
 *
 * No webhooks from Postiz — we just POST to /posts and trust the 2xx
 * response. Consumers can later poll GET /posts/list for delivery
 * confirmation if needed.
 */

const VANTLY_BASE_URL = Deno.env.get("VANTLY_API_BASE_URL") ?? "https://vantly.social/api/public/v1";

export interface VantlyIntegration {
  id: string;
  name: string;
  identifier: string; // 'tiktok' | 'instagram' | 'x' | 'youtube' | …
  picture: string | null;
  disabled: boolean;
  profile: string | null;
}

export interface VantlyUpload {
  id: string;
  name: string;
  path: string; // e.g. https://uploads.postiz.com/<filename>
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface VantlyCreatedPost {
  postId: string;
  integration: string;
}

export class VantlyError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function vantlyFetch<T>(
  method: "GET" | "POST",
  path: string,
  apiKey: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(`${VANTLY_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "vantly-ugc-vantly/1.0",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    let parsed: unknown = null;
    const text = await resp.text();
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!resp.ok) {
      throw new VantlyError(
        resp.status,
        parsed,
        `Postiz ${method} ${path} failed: HTTP ${resp.status} — ${text.slice(0, 300)}`,
      );
    }
    return parsed as T;
  } finally {
    clearTimeout(t);
  }
}

export async function listIntegrations(apiKey: string): Promise<VantlyIntegration[]> {
  return await vantlyFetch<VantlyIntegration[]>("GET", "/integrations", apiKey);
}

export async function uploadFromUrl(apiKey: string, url: string): Promise<VantlyUpload> {
  return await vantlyFetch<VantlyUpload>("POST", "/upload-from-url", apiKey, { url });
}

/**
 * Schedule (or immediately publish) a post. We use type:'schedule' with a
 * date in the immediate past, which Postiz interprets as "publish now".
 *
 * @param apiKey         User's Postiz API key.
 * @param integrationId  Target integration UUID from GET /integrations.
 * @param mediaPath      Path returned from POST /upload-from-url (e.g. https://uploads.postiz.com/...).
 * @param content        Caption text (max length depends on platform).
 * @param platformType   Postiz settings.__type — must match the integration's
 *                       platform (e.g. 'tiktok', 'instagram-standalone',
 *                       'x', 'youtube', 'linkedin'). When unsure, pass the
 *                       integration's `identifier` field.
 */
export async function createPost(
  apiKey: string,
  args: {
    integrationId: string;
    mediaPath: string;
    content: string;
    platformType: string;
    publishAt?: Date;     // default: now
    shortLink?: boolean;  // default: false
    tags?: string[];      // default: []
  },
): Promise<VantlyCreatedPost[]> {
  const date = (args.publishAt ?? new Date()).toISOString();
  const body = {
    type: "schedule",
    date,
    shortLink: args.shortLink ?? false,
    tags: args.tags ?? [],
    posts: [
      {
        integration: { id: args.integrationId },
        value: [
          {
            content: args.content,
            image: [
              {
                id: `vantly-ugc-${Date.now()}`,
                path: args.mediaPath,
              },
            ],
          },
        ],
        settings: settingsFor(args.platformType),
      },
    ],
  };
  return await vantlyFetch<VantlyCreatedPost[]>("POST", "/posts", apiKey, body);
}

/**
 * Per-platform required settings. Postiz validates these server-side and
 * 400s if mandatory fields are missing. Known requirements:
 *   - x: who_can_reply_post (everyone | mentionedUsers | following | verified | subscribers)
 *   - tiktok: privacy_level + similar visibility flags
 *   - youtube: privacyStatus
 * Default to the most-permissive sane value so the post actually goes out;
 * future work can let users override per integration.
 */
function settingsFor(platformType: string): Record<string, unknown> {
  switch (platformType) {
    case "x":
      return {
        __type: "x",
        who_can_reply_post: "everyone",
      };
    default:
      return { __type: platformType };
  }
}
