// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Builds the `settings` object POST /posts requires per network, matching
 * the required-field shape of Vantly's own per-provider settings DTOs
 * (verified against vantly/libraries/nestjs-libraries/src/dtos/posts/
 * providers-settings/*.dto.ts — this app has no access to that repo at
 * runtime, so these constraints are hand-mirrored and must be re-checked
 * there if Vantly's DTOs change).
 *
 * Every network falls into exactly one of three buckets:
 *
 *  1. No required fields beyond the `settings.__type` discriminator
 *     (kick/twitch/facebook/linkedin/linkedin-page/gmb/threads/mastodon/
 *     bluesky/telegram/nostr/vk) - nothing to build.
 *  2. A required field that's a fixed operational choice, not post content
 *     (TikTok's content_posting_method/privacy_level/duet/..., Instagram's
 *     post_type, MeWe's postType) - a fixed default, no model call. These
 *     lean toward "Publish Now" actually publishing live/public, matching
 *     what tiktok/instagram/x already did before this file existed.
 *  3. A required field that IS post content - a title, subtitle, or tags -
 *     within a hard length limit (YouTube/WordPress/Dribbble/Medium/DevTo).
 *     generateSocialCopy() below derives all of it in ONE model call per
 *     publish request (not one per network), and every caller clamps the
 *     result to fit rather than trusting the model to land inside a
 *     class-validator MinLength/MaxLength on its own.
 *
 * Deliberately NOT covered here (see ALLOWED_PROVIDERS in
 * routes/v1/social.ts): any network whose required field names a real
 * resource that has to already exist on the connected account specifically
 * - Pinterest's board, Discord/Slack's channel, Reddit/Lemmy's subreddit +
 * flair, Skool/Whop's group, Farcaster's channel, Listmonk's list,
 * Moltbook's submolt, Hashnode's publication, Dev.to's numeric tag ids. No
 * model call can safely invent an id for something that has to already
 * exist and belong to that account - guessing wrong doesn't degrade
 * gracefully, it silently posts to the wrong place (or a real DevTo tag
 * that happens to share a guessed numeric id). Those channels stay
 * unlisted until vantly-ugc has an actual picker backed by a real Vantly
 * endpoint to enumerate that account's boards/channels/subreddits.
 */

import { callAnthropicMessages } from './anthropic-client.js';

const MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6';

// YouTube caps the combined length of all tags at 500 characters (mirrors
// YOUTUBE_TAGS_MAX_LENGTH in vantly's youtube.settings.dto.ts).
const YOUTUBE_TAGS_BUDGET = 480; // small safety margin under the real 500 cap

export interface PostCopyInput {
  caption: string;
  title?: string | null;
  prompt?: string | null;
}

export interface GeneratedCopy {
  title: string;
  subtitle: string;
  tags: string[];
}

const EMPTY_COPY: GeneratedCopy = { title: '', subtitle: '', tags: [] };

const SYSTEM_PROMPT = `You write short titles and metadata for a social/video post, from its caption and (if given) its original creation prompt or working title. The "working title" you're given is often actually the video's full script or lyrics, not a real title - never copy it, the caption, or the prompt verbatim into TITLE or SUBTITLE; always write new, original, short text in your own words, however long the input is. Output EXACTLY this format, nothing else, no surrounding quotes on any line:
TITLE: <a punchy original title, 3-12 words, never a copy of the input text>
SUBTITLE: <a one-sentence original subtitle/summary, worded differently from the title and from the input>
TAGS: <3-6 short topical tags, comma separated, no # symbol, lowercase>`;

/**
 * One Anthropic call that derives a title/subtitle/tags set good enough to
 * clamp into every network that needs one - called at most once per publish
 * request (see createPost in vantly.ts), never per network.
 *
 * Never throws: a missing/failed model call must not block publishing to
 * networks with no settings requirements just because one network wanted
 * a nicer title. Every caller below has its own caption-derived fallback
 * for when this comes back empty.
 */
export async function generateSocialCopy(input: PostCopyInput): Promise<GeneratedCopy> {
  const userMessageParts = [
    input.title ? `Existing working title: ${input.title}` : null,
    `Caption: ${input.caption || '(none)'}`,
    input.prompt ? `Original creation prompt: ${input.prompt}` : null,
    'Write the TITLE/SUBTITLE/TAGS now, in the exact format specified.',
  ].filter((p): p is string => !!p);

  try {
    const upstream = await callAnthropicMessages(
      {
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessageParts.join('\n\n') }],
      },
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error(`[social-post-settings] generateSocialCopy: model call failed HTTP ${upstream.status}: ${text.slice(0, 300)}`);
      return EMPTY_COPY;
    }
    const data = (await upstream.json()) as { content?: Array<{ type?: string; text?: string }> };
    const raw = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
    const subtitleMatch = raw.match(/^SUBTITLE:\s*(.+)$/m);
    const tagsMatch = raw.match(/^TAGS:\s*(.+)$/m);
    const tags = (tagsMatch?.[1] ?? '')
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    return {
      title: stripQuotes(titleMatch?.[1]),
      subtitle: stripQuotes(subtitleMatch?.[1]),
      tags,
    };
  } catch (err) {
    console.error('[social-post-settings] generateSocialCopy threw:', err instanceof Error ? err.message : err);
    return EMPTY_COPY;
  }
}

function stripQuotes(s?: string): string {
  return (s ?? '').trim().replace(/^["“](.*)["”]$/s, '$1').trim();
}

/** Clamp to [min, max] chars, breaking on a word boundary where possible, with a guaranteed non-empty result once `min` is reachable at all. */
function clampTitle(preferred: string, fallback: string, min: number, max: number): string {
  let t = (preferred || '').trim();
  if (t.length < min) t = (fallback || '').trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    t = (lastSpace > min ? cut.slice(0, lastSpace) : cut).trim();
  }
  if (t.length < min) {
    // Last resort: neither the model's title nor the caption alone reached
    // the platform's minimum (e.g. a one-word caption against YouTube's
    // 2-char floor) - pad rather than let a hard MinLength reject the post.
    t = (t || fallback || 'Video').padEnd(min, ' ·');
  }
  return t.slice(0, max);
}

/** A short, caption-derived fallback title for when the model call fails or returns nothing — always just the first few words, never the full caption verbatim (captions are often one long unbroken line, e.g. lyrics joined with "/" rather than real line breaks). */
function captionFallbackTitle(caption: string): string {
  const flat = (caption || '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'New video';
  return flat.split(' ').slice(0, 8).join(' ');
}

export interface SettingsContext {
  network: string;
  caption: string;
  /** Pre-computed once per publish request by createPost - undefined for networks that don't need it. */
  copy?: GeneratedCopy;
  /** Public URL of the uploaded video (from Vantly's own /upload-from-url — a real public URL on Vantly's storage, not a path needing a domain prefix). Only used by buildNetworkContent, for networks that can embed a playable video directly in the post body. */
  mediaUrl?: string;
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the post BODY (Postiz's `value[].content`) per network — separate
 * from buildNetworkSettings, which only builds the `settings` object.
 *
 * Every network except WordPress just gets the caption back unchanged —
 * that's the correct, already-working behavior for a short-form caption
 * (X, Instagram, TikTok, etc. all render `content` as the literal post
 * text/caption).
 *
 * WordPress is different: it's a full blog post, not a caption, and
 * WordpressProvider.post() (vantly's backend) has NO video-upload support
 * at all — it only ever uploads `settings.main_image` as a featured image.
 * A WordPress post published through this app would otherwise contain the
 * caption as the entire body with no video and no real description. So for
 * WordPress specifically, build real HTML: an embedded <video> tag pointing
 * at the video's own public URL (playable directly in the post, since
 * `wp_kses_post` — WordPress's REST API content sanitizer — allows
 * video/source/track tags for any authenticated user, not just admins),
 * followed by the LLM-generated description, followed by the original
 * caption as its own paragraph.
 */
export function buildNetworkContent(ctx: SettingsContext): string {
  if (ctx.network !== 'wordpress') return ctx.caption;

  const copy = ctx.copy ?? EMPTY_COPY;
  const description = (copy.subtitle || '').trim();
  const videoBlock = ctx.mediaUrl
    ? `<p><video controls preload="metadata" style="max-width:100%;height:auto;" src="${escapeHtml(ctx.mediaUrl)}"></video></p>`
    : '';
  const descriptionBlock = description ? `<p>${escapeHtml(description)}</p>` : '';
  const captionBlock = ctx.caption ? `<p>${escapeHtml(ctx.caption).replace(/\n/g, '<br>')}</p>` : '';

  return [videoBlock, descriptionBlock, captionBlock].filter(Boolean).join('\n') || ctx.caption;
}

// Networks with genuinely no required settings fields beyond `__type`.
const NO_SETTINGS_NETWORKS = new Set([
  'kick', 'twitch', 'facebook', 'linkedin', 'linkedin-page', 'gmb',
  'threads', 'mastodon', 'bluesky', 'telegram', 'nostr', 'vk',
]);

// Networks whose required settings need generated title/subtitle/tag copy.
export const COPY_NEEDED_NETWORKS = new Set(['youtube', 'wordpress', 'dribbble', 'medium', 'devto']);

export function buildNetworkSettings(ctx: SettingsContext): Record<string, unknown> {
  const base = { __type: ctx.network };
  const fallbackTitle = captionFallbackTitle(ctx.caption);
  const copy = ctx.copy ?? EMPTY_COPY;

  if (NO_SETTINGS_NETWORKS.has(ctx.network)) {
    return base;
  }

  switch (ctx.network) {
    case 'x':
      // Without who_can_reply_post the post is rejected.
      return { ...base, who_can_reply_post: 'everyone' };

    case 'mewe':
      // 'timeline' needs no group id; 'group' would need a real group id we don't have.
      return { ...base, postType: 'timeline' };

    case 'instagram':
    case 'instagram-standalone':
      return { ...base, post_type: 'post' };

    case 'tiktok':
      return {
        ...base,
        // DIRECT_POST actually publishes; 'UPLOAD' only drops it in the
        // user's TikTok inbox as an unpublished draft - the opposite of
        // what "Publish Now" means.
        content_posting_method: 'DIRECT_POST',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        duet: true,
        stitch: true,
        comment: true,
        autoAddMusic: 'no',
        // Both false: we have no actual paid/branded-content relationship
        // to declare, and declaring one incorrectly is a policy problem in
        // the other direction that a silent default must not risk.
        brand_content_toggle: false,
        brand_organic_toggle: false,
        // Accurate, not a guess: every video this app publishes IS AI
        // generated, and TikTok requires this disclosure.
        video_made_with_ai: true,
        title: clampTitle(copy.title, fallbackTitle, 1, 90),
      };

    case 'tumblr':
      // Every field here is optional - included for quality, not required.
      return {
        ...base,
        title: clampTitle(copy.title, fallbackTitle, 1, 4096),
        ...(copy.tags.length > 0 ? { tags: copy.tags.slice(0, 10).join(',') } : {}),
      };

    case 'youtube':
      return {
        ...base,
        title: clampTitle(copy.title, fallbackTitle, 2, 100),
        // 'public' matches what "Publish Now" already means for every
        // other network here - see the file header if you want something
        // more conservative (e.g. 'unlisted') by default instead.
        type: 'public',
        ...(copy.tags.length > 0 ? { tags: buildYoutubeTags(copy.tags) } : {}),
      };

    case 'wordpress':
      return {
        ...base,
        title: clampTitle(copy.title, fallbackTitle, 2, 150),
        // The WordPress REST collection to post into - 'posts' is a normal
        // blog post (see WordpressProvider.post, which builds the request
        // URL as wp-json/wp/v2/${settings.type}).
        type: 'posts',
        status: 'publish',
      };

    case 'dribbble':
      return { ...base, title: clampTitle(copy.title, fallbackTitle, 1, 100) };

    case 'medium':
      return {
        ...base,
        title: clampTitle(copy.title, fallbackTitle, 2, 100),
        subtitle: clampTitle(copy.subtitle, fallbackTitle, 2, 150),
        ...(copy.tags.length > 0
          ? { tags: copy.tags.slice(0, 4).map((t) => ({ value: t, label: t })) }
          : {}),
      };

    case 'devto':
      // No tags: DevTo's tag ids are real numeric ids from its own tag
      // taxonomy (DevToTagsSettingsDto.value: number) - a model can't
      // invent one without risking a real, unrelated tag. Leaving the
      // array empty is valid; guessing a number is not.
      return { ...base, title: clampTitle(copy.title, fallbackTitle, 2, 100), tags: [] };

    default:
      return base;
  }
}

/** Builds YouTube's tags[] within its combined-length budget, dropping tags once the running total would exceed it rather than truncating one mid-word. */
function buildYoutubeTags(tags: string[]): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  let total = 0;
  for (const tag of tags) {
    const clean = tag.trim();
    if (!clean) continue;
    const cost = clean.length + (/\s/.test(clean) ? 2 : 0);
    if (total + cost > YOUTUBE_TAGS_BUDGET) break;
    out.push({ value: clean, label: clean });
    total += cost;
  }
  return out;
}
