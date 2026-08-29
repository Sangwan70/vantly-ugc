// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * /v1/social/* — connect social channels (TikTok / Instagram / X) and publish
 * vantly-ugc videos to them via our self-hosted Vantly instance (a Postiz
 * fork at https://vantly.social).
 *
 * This used to auto-provision a Postiz "Enterprise" sub-account per user
 * (postiz_users table + lib/postiz.ts's now-removed create-user/add-channel
 * calls). Vantly has no Enterprise-tier API, and doesn't need one: every user
 * here already has a per-user credential in profiles.vantly_api_key — either
 * pasted manually or obtained via the "Connect with Vantly" OAuth flow (see
 * apps/web/app/api/integrations/postiz/oauth/*) — and that's all Vantly's own
 * /public/v1 API needs to resolve them straight to their own organization.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../server.js';
import {
  listAvailableProviders,
  listIntegrations,
  getConnectUrl,
  deleteIntegration,
  uploadFromUrl,
  createPost,
} from '../../lib/vantly.js';

// The providers we expose in the UI (user asked for TikTok, Instagram, X).
const ALLOWED_PROVIDERS = new Set(['tiktok', 'instagram', 'instagram-standalone', 'x']);

const R2_PUBLIC = (process.env.R2_PUBLIC_URL || 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev').replace(/\/+$/, '');

function uid(req: Request): string | null {
  return (req as { userId?: string }).userId ?? null;
}

class NotConnectedError extends Error {
  status = 400;
  code = 'vantly_not_connected';
  constructor() {
    super('Connect your Vantly account first (see /integrations/vantly).');
  }
}

/** The user's stored Vantly credential — a pasted API key or an OAuth access token, used identically. */
async function getVantlyToken(userId: string): Promise<string> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('vantly_api_key')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error('Could not load profile');
  const token = (profile?.vantly_api_key as string | null) ?? null;
  if (!token) throw new NotConnectedError();
  return token;
}

function respondVantlyError(res: Response, e: unknown): void {
  if (e instanceof NotConnectedError) {
    res.status(400).json({ error: e.code, detail: e.message });
    return;
  }
  const status = (e as { status?: number }).status;
  res.status(status === 401 || status === 403 ? 400 : 502).json({
    error: status === 401 || status === 403 ? 'vantly_auth_failed' : 'vantly_error',
    detail: e instanceof Error ? e.message : 'Vantly request failed',
  });
}

/** GET /v1/social/providers — the connectable networks (static catalog, cached). */
export async function listSocialProvidersRoute(_req: Request, res: Response): Promise<void> {
  try {
    const all = await listAvailableProviders();
    const providers = all.filter((p) => ALLOWED_PROVIDERS.has(p.identifier));
    res.status(200).json({ providers });
  } catch (e) {
    respondVantlyError(res, e);
  }
}

/** GET /v1/social/channels — the user's connected channels. */
export async function listSocialChannelsRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const token = await getVantlyToken(userId);
    const raw = await listIntegrations(token);
    // Normalize: Vantly returns the network in `identifier`; expose it as `provider`.
    const channels = (raw ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.identifier,
      profile: c.profile ?? null,
      picture: c.picture ?? null,
      disabled: c.disabled ?? false,
    }));
    res.status(200).json({ channels });
  } catch (e) {
    respondVantlyError(res, e);
  }
}

/**
 * POST /v1/social/connect { provider } — returns the connect URL to open.
 *
 * LIMITATION: Vantly's /public/v1/social/:integration endpoint (unlike the
 * old commercial Enterprise API) doesn't accept a redirect URL — after the
 * network's own OAuth completes, the browser lands back on vantly.social,
 * not here. The client surfaces this so the UI can tell users to come back
 * and hit refresh.
 */
export async function connectSocialRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const provider = String(req.body?.provider ?? '');
  if (!ALLOWED_PROVIDERS.has(provider)) {
    res.status(400).json({ error: 'invalid_provider', detail: `provider must be one of: ${[...ALLOWED_PROVIDERS].join(', ')}` });
    return;
  }
  try {
    const token = await getVantlyToken(userId);
    const url = await getConnectUrl(token, provider);
    res.status(200).json({
      url,
      note: 'You will land back on vantly.social once connected — return here and refresh.',
    });
  } catch (e) {
    respondVantlyError(res, e);
  }
}

/** DELETE /v1/social/channels/:channelId — disconnect a channel. */
export async function deleteSocialChannelRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const channelId = String(req.params.channelId ?? '');
  if (!channelId) { res.status(400).json({ error: 'missing_channel_id' }); return; }
  try {
    const token = await getVantlyToken(userId);
    await deleteIntegration(token, channelId);
    res.status(200).json({ success: true });
  } catch (e) {
    respondVantlyError(res, e);
  }
}

/**
 * POST /v1/social/publish
 *   { video_url (R2), channel_ids: string[], caption, type: 'now'|'schedule', date? }
 * Uploads the video to Vantly then posts/schedules it to each channel.
 */
export async function publishSocialRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const body = req.body ?? {};
  const videoUrl = String(body.video_url ?? '');
  const channelIds: string[] = Array.isArray(body.channel_ids) ? body.channel_ids.map(String) : [];
  const caption = String(body.caption ?? '').slice(0, 2000);
  const type = body.type === 'schedule' ? 'schedule' : 'now';
  const date = body.date ? String(body.date) : undefined;

  // SSRF guard: only our own R2-hosted videos.
  if (!videoUrl.startsWith(R2_PUBLIC + '/')) {
    res.status(400).json({ error: 'video_url must be an vantly-ugc R2 URL' });
    return;
  }
  if (channelIds.length === 0) { res.status(400).json({ error: 'channel_ids required' }); return; }
  if (type === 'schedule' && !date) { res.status(400).json({ error: 'date required when type=schedule' }); return; }

  try {
    const token = await getVantlyToken(userId);

    // Resolve each picked channel to its network (needed for settings.__type).
    const userChannels = await listIntegrations(token);
    const byId = new Map(userChannels.map((c) => [c.id, c]));
    const unknown = channelIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      res.status(400).json({ error: 'unknown_channel', detail: `not a connected channel: ${unknown.join(', ')}` });
      return;
    }

    // Register the (R2-hosted) video with Vantly by URL — it fetches it
    // itself and returns a path on its own upload domain (required by /posts).
    const media = await uploadFromUrl(token, videoUrl);

    const result = await createPost(token, {
      type,
      date,
      posts: channelIds.map((integrationId) => ({
        integrationId,
        network: byId.get(integrationId)!.identifier,
        content: caption,
        media: [{ id: media.id, path: media.path! }],
      })),
    });

    res.status(200).json({ success: true, media_id: media.id, post_ids: result.postIds });
  } catch (e) {
    respondVantlyError(res, e);
  }
}
