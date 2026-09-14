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
  listPosts,
} from '../../lib/vantly.js';

// The providers we expose in the UI (user asked for TikTok, Instagram, X).
// Every network vantly-ugc can build a valid createPost `settings` payload
// for (see buildNetworkSettings in lib/social-post-settings.ts) — either it
// needs no settings beyond __type, a fixed operational default, or an
// LLM-derived title/subtitle/tags clamped to that platform's limits.
// Deliberately excludes networks whose required setting names a real
// account-specific resource (Pinterest board, Discord/Slack channel, Reddit/
// Lemmy subreddit, Skool/Whop group, Farcaster channel, Listmonk list,
// Moltbook submolt, Hashnode publication) — no model call can safely invent
// an id that has to already exist and belong to that account.
const ALLOWED_PROVIDERS = new Set([
  'tiktok', 'instagram', 'instagram-standalone', 'x',
  'kick', 'twitch', 'facebook', 'linkedin', 'linkedin-page', 'gmb',
  'threads', 'mastodon', 'bluesky', 'telegram', 'nostr', 'vk', 'mewe',
  'tumblr', 'youtube', 'wordpress', 'dribbble', 'medium', 'devto',
]);

const R2_PUBLIC = (process.env.R2_PUBLIC_URL || 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev').replace(/\/+$/, '');

// How long a just-published (video, channel) pair stays protected against an
// immediate re-publish — long enough to absorb rapid re-clicks / a
// double-submitted request, short enough that a deliberate re-post later
// isn't permanently blocked. See idx_vantly_publications_dedup (the DB-level
// backstop for in-flight duplicates, which has no time window at all — it
// only ever covers pending/uploaded/published rows, and 'published' rows
// age out of this app-layer check, not the DB one).
const RECENT_PUBLISH_WINDOW_MS = 2 * 60 * 1000;

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

/**
 * GET /v1/social/channels — the user's connected channels.
 *
 * Filtered to ALLOWED_PROVIDERS: Vantly's /integrations endpoint returns
 * every channel connected to the user's Vantly org, including networks
 * (YouTube, Pinterest, ...) the user may have connected directly on
 * vantly.social itself, outside this app. This app only knows how to build
 * a valid createPost `settings` payload for ALLOWED_PROVIDERS (see
 * networkSettings in lib/vantly.ts) - surfacing an unsupported channel here
 * let a user select it for publishing and get a raw Vantly 400 (missing
 * required per-network settings like YouTube's title/type or Pinterest's
 * board) instead of never seeing it as an option.
 */
export async function listSocialChannelsRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const token = await getVantlyToken(userId);
    const raw = await listIntegrations(token);
    // Normalize: Vantly returns the network in `identifier`; expose it as `provider`.
    const channels = (raw ?? [])
      .filter((c) => ALLOWED_PROVIDERS.has(c.identifier))
      .map((c) => ({
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

interface PublishResult {
  channel_id: string;
  status: 'published' | 'failed' | 'already_in_progress';
  publication_id?: string;
  error?: string;
  /** Only set when status is 'already_in_progress' — lets the caller decide whether "publish anyway" makes sense (both do; this is just for a clearer message). */
  reason?: 'in_progress' | 'recent';
}

/** Mark every still-tracked channel's row failed after an upload/post-time exception. Best-effort — a logging failure here must never mask the original error. */
async function markRowsFailed(rowIdByChannel: Map<string, string>, channelIds: string[], message: string): Promise<void> {
  const ids = channelIds.map((c) => rowIdByChannel.get(c)).filter((id): id is string => !!id);
  if (ids.length === 0) return;
  try {
    await supabase
      .from('vantly_publications')
      .update({ status: 'failed', error_message: message.slice(0, 2000) })
      .in('id', ids);
  } catch {
    // best-effort audit trail — swallow so the real error still propagates
  }
}

/**
 * POST /v1/social/publish
 *   { video_url (R2), channel_ids: string[], caption, type: 'now'|'schedule', date?,
 *     run_id?, source? }
 *
 * Uploads the video to Vantly then posts/schedules it to each channel.
 *
 * `run_id`/`source` (mirroring GalleryItem.run_id/source from
 * GET /v1/me/gallery) are what enable idempotency + status tracking: when
 * present (the /dashboard/social manual publish flow always sends them),
 * this writes/updates vantly_publications rows per channel and refuses to
 * re-publish a (run_id, channel) pair that's currently in flight or that
 * succeeded within the last two minutes — see RECENT_PUBLISH_WINDOW_MS.
 * When absent (the Gallery page's hover "PublishToSocial" quick-publish
 * button doesn't send them), this behaves exactly as before: no dedup
 * check, no tracking rows, just upload + post.
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
  const runId = body.run_id ? String(body.run_id) : null;
  const source = body.source ? String(body.source) : null;
  // Source video's working title/prompt, if the caller has them — used to
  // derive a real title/subtitle for networks that require post-content
  // settings fields (YouTube, WordPress, Dribbble, Medium, DevTo). Optional:
  // callers that don't send them (e.g. the Gallery quick-publish button)
  // still work, just with a caption-derived fallback title.
  const title = body.title ? String(body.title).slice(0, 500) : null;
  const prompt = body.prompt ? String(body.prompt).slice(0, 2000) : null;
  // "Promote my platforms" checkbox — appended server-side (see
  // buildNetworkContent in lib/social-post-settings.ts) rather than
  // pre-merged into `caption` on the frontend, so it can never end up being
  // the ONLY thing in a post body when the caption box was left empty, and
  // never contaminates what the LLM sees as the caption to write copy from.
  const addPromoLinks = body.add_promo_links === true;
  // Channels the user explicitly confirmed a re-publish for, past the
  // "already publishing or recently published" guard below. Never implicit
  // — the frontend only ever sends a channel here after showing the user
  // that exact channel's skip reason and getting an explicit click. This
  // does NOT bypass the actual concurrency guard (the DB insert's unique
  // constraint further down) — a truly-concurrent duplicate request still
  // gets caught there; this only lifts the soft "you already did this
  // recently, are you sure" precheck for the channels the user confirmed.
  const forceChannelIds = new Set<string>(
    Array.isArray(body.force_channel_ids) ? body.force_channel_ids.map(String) : [],
  );

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
    // Belt-and-suspenders: listSocialChannelsRoute already filters to
    // ALLOWED_PROVIDERS, but this endpoint trusts whatever channel_ids the
    // caller sends, so re-check here too. Without this, a channel this app
    // has no settings-building support for (e.g. YouTube, which requires
    // settings.title/type, or Pinterest, which requires settings.board -
    // see networkSettings in lib/vantly.ts) reaches Vantly's /posts and
    // fails validation there instead of with a clear error here.
    const unsupported = channelIds.filter((id) => !ALLOWED_PROVIDERS.has(byId.get(id)!.identifier));
    if (unsupported.length > 0) {
      res.status(400).json({
        error: 'unsupported_provider',
        detail: `vantly-ugc can't publish to this channel's network yet: ${unsupported
          .map((id) => `${id} (${byId.get(id)!.identifier})`)
          .join(', ')}`,
      });
      return;
    }

    const results: PublishResult[] = [];
    let publishChannelIds = channelIds;
    const rowIdByChannel = new Map<string, string>();

    if (runId) {
      const { data: existingRows } = await supabase
        .from('vantly_publications')
        .select('integration_id, status, published_at')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .in('integration_id', channelIds);
      // Never skip a channel implicitly without telling the user why — every
      // blocked channel comes back in `results` with a `reason` so the UI
      // can show it and offer "publish anyway" one channel at a time,
      // rather than silently dropping it from the batch.
      const blocked = new Map<string, 'in_progress' | 'recent'>();
      for (const row of existingRows ?? []) {
        const cid = row.integration_id as string;
        if (forceChannelIds.has(cid)) continue; // user already confirmed this one — don't block it again
        const st = row.status as string;
        if (st === 'pending' || st === 'uploaded') {
          blocked.set(cid, 'in_progress');
        } else if (st === 'published') {
          const publishedAtMs = row.published_at ? new Date(row.published_at as string).getTime() : 0;
          if (Date.now() - publishedAtMs < RECENT_PUBLISH_WINDOW_MS) blocked.set(cid, 'recent');
        }
      }
      for (const cid of channelIds) {
        const reason = blocked.get(cid);
        if (reason) results.push({ channel_id: cid, status: 'already_in_progress', reason });
      }
      publishChannelIds = channelIds.filter((cid) => !blocked.has(cid));

      // Insert 'pending' rows up front, one per channel. This doubles as
      // the hard backstop against a genuine race between two concurrent
      // publish requests for the same (run_id, channel): a conflict here
      // means idx_vantly_publications_dedup already has a live row for
      // that pair, so we treat it exactly like the blocked check above
      // rather than erroring the whole request.
      for (const cid of publishChannelIds) {
        const { data: row, error: insertErr } = await supabase
          .from('vantly_publications')
          .insert({ user_id: userId, run_id: runId, source, origin: 'manual', integration_id: cid, status: 'pending' })
          .select('id')
          .single();
        if (insertErr || !row) {
          results.push({ channel_id: cid, status: 'already_in_progress' });
          continue;
        }
        rowIdByChannel.set(cid, row.id as string);
      }
      publishChannelIds = publishChannelIds.filter((cid) => rowIdByChannel.has(cid));
    }

    if (publishChannelIds.length === 0) {
      res.status(200).json({ success: results.length > 0, media_id: null, results });
      return;
    }

    let media: { id: string; path: string };
    try {
      media = await uploadFromUrl(token, videoUrl);
    } catch (e) {
      if (runId) await markRowsFailed(rowIdByChannel, publishChannelIds, e instanceof Error ? e.message : 'upload failed');
      throw e;
    }

    if (runId && rowIdByChannel.size > 0) {
      const ids = publishChannelIds.map((c) => rowIdByChannel.get(c)).filter((id): id is string => !!id);
      if (ids.length > 0) {
        await supabase
          .from('vantly_publications')
          .update({ status: 'uploaded', vantly_upload_id: media.id, vantly_upload_path: media.path, uploaded_at: new Date().toISOString() })
          .in('id', ids);
      }
    }

    let created: Awaited<ReturnType<typeof createPost>>;
    try {
      created = await createPost(token, {
        type,
        date,
        addPromoLinks,
        posts: publishChannelIds.map((integrationId) => ({
          integrationId,
          network: byId.get(integrationId)!.identifier,
          content: caption,
          media: [{ id: media.id, path: media.path! }],
          title,
          prompt,
        })),
      });
    } catch (e) {
      if (runId) await markRowsFailed(rowIdByChannel, publishChannelIds, e instanceof Error ? e.message : 'create post failed');
      throw e;
    }

    const postIdByChannel = new Map(created.results.map((r) => [r.integrationId, r.postId]));
    for (const cid of publishChannelIds) {
      const postId = postIdByChannel.get(cid);
      const rowId = rowIdByChannel.get(cid);
      if (postId) {
        results.push({ channel_id: cid, status: 'published', publication_id: rowId });
        if (runId && rowId) {
          await supabase
            .from('vantly_publications')
            .update({ status: 'published', vantly_post_id: postId, published_at: new Date().toISOString() })
            .eq('id', rowId);
        }
      } else {
        const message = "Vantly did not confirm this channel's post";
        results.push({ channel_id: cid, status: 'failed', publication_id: rowId, error: message });
        if (runId && rowId) {
          await supabase.from('vantly_publications').update({ status: 'failed', error_message: message }).eq('id', rowId);
        }
      }
    }

    res.status(200).json({ success: true, media_id: media.id, results });
  } catch (e) {
    respondVantlyError(res, e);
  }
}

/**
 * GET /v1/social/publications/:id/resolve-url — resolve a published row's
 * platform permalink, if Postiz has one yet.
 *
 * POST /posts's own response never includes a permalink, and Postiz has no
 * lifecycle webhooks, so this calls List Posts (the only endpoint that
 * returns `releaseURL`) as a follow-up. The frontend polls this a handful
 * of times after a channel reaches 'published' — see
 * apps/web/app/(app-dark)/dashboard/social/page.tsx.
 */
export async function resolvePublicationUrlRoute(req: Request, res: Response): Promise<void> {
  const userId = uid(req);
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const id = String(req.params.id ?? '');
  if (!id) { res.status(400).json({ error: 'missing_id' }); return; }
  try {
    const { data: row, error } = await supabase
      .from('vantly_publications')
      .select('id, status, vantly_post_id, release_url, published_at')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !row) { res.status(404).json({ error: 'not_found' }); return; }
    if (row.release_url) { res.status(200).json({ release_url: row.release_url }); return; }
    if (row.status !== 'published' || !row.vantly_post_id) { res.status(200).json({ release_url: null }); return; }

    const token = await getVantlyToken(userId);
    const publishedAt = row.published_at ? new Date(row.published_at as string) : new Date();
    const startDate = new Date(publishedAt.getTime() - 60 * 60 * 1000).toISOString();
    const endDate = new Date(Date.now() + 60 * 1000).toISOString();
    const posts = await listPosts(token, { startDate, endDate });
    const match = posts.find((p) => p.id === row.vantly_post_id);
    if (match?.releaseURL) {
      await supabase.from('vantly_publications').update({ release_url: match.releaseURL }).eq('id', id);
      res.status(200).json({ release_url: match.releaseURL });
      return;
    }
    res.status(200).json({ release_url: null });
  } catch (e) {
    respondVantlyError(res, e);
  }
}
