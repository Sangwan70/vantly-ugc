// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Builds the per-network `settings` object AND post body/description for
 * POST /posts (verified against vantly/libraries/nestjs-libraries/src/dtos/
 * posts/providers-settings/*.dto.ts — this app has no access to that repo
 * at runtime, so these constraints are hand-mirrored and must be re-checked
 * there if Vantly's DTOs change).
 *
 * Two responsibilities live here, both driven by ONE Anthropic call per
 * publish request (generateSocialCopy, called once in vantly.ts's
 * createPost — never once per network):
 *
 *  - buildNetworkSettings(): the required `settings.*` fields each network's
 *    Postiz DTO validates (a title field, a fixed operational default, or
 *    nothing at all — see the network buckets below).
 *  - buildNetworkContent(): the post BODY every network actually publishes —
 *    an eye-grabbing title's matching marketing description ("Wow! You can
 *    create videos like this with Vantly UGC...", what prompt made the
 *    video, and hashtags), clamped to fit that specific network's real
 *    character limit rather than one string sent everywhere unmodified,
 *    plus (WordPress only) an embedded <video> tag, since
 *    WordpressProvider.post() never uploads video on its own.
 *
 * Settings buckets (buildNetworkSettings):
 *  1. No required fields beyond the `settings.__type` discriminator
 *     (kick/twitch/facebook/linkedin/linkedin-page/gmb/threads/mastodon/
 *     bluesky/telegram/nostr/vk) - nothing to build.
 *  2. A required field that's a fixed operational choice, not post content
 *     (TikTok's content_posting_method/privacy_level/duet/..., Instagram's
 *     post_type, MeWe's postType) - a fixed default, no model call. These
 *     lean toward "Publish Now" actually publishing live/public.
 *  3. A required field that IS post content - a title (YouTube/WordPress/
 *     Dribbble/Medium/DevTo/TikTok's optional title) - within a hard length
 *     limit; every caller clamps the model's result to fit rather than
 *     trusting it to land inside a class-validator MinLength/MaxLength.
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

// Appended to the post body (its own line, always last) when the caller
// opts in via the "promote my platforms" checkbox. Single source of truth —
// the frontend only sends a boolean and mirrors this exact string for its
// own preview text (apps/web/.../dashboard/social/page.tsx) — so it and
// this file must be kept in sync by hand if the wording ever changes.
export const PROMO_LINE = 'Video generated at https://vantly-ugc.com and shared via https://vantly.social';

// Real (or, where a platform has no hard published cap, a deliberately
// conservative) per-network body/description character limits, so the
// composed marketing description never gets rejected or silently mangled
// by a platform-side truncation. A network missing here just falls back to
// DEFAULT_BODY_LIMIT, which is safe (short) rather than wrong.
const PLATFORM_BODY_LIMITS: Record<string, number> = {
  x: 280,
  bluesky: 300,
  threads: 500,
  mastodon: 500, // the common default instance config; self-hosted instances vary but this is a safe floor
  instagram: 2200,
  'instagram-standalone': 2200,
  tiktok: 2200,
  telegram: 1024, // caption-on-media limit (this app always attaches the video) — not the 4096 text-only limit
  tumblr: 4096,
  gmb: 1500,
  vk: 4096,
  kick: 500,
  twitch: 500,
  mewe: 5000,
  facebook: 2000, // ~63k is technically allowed; kept to normal social-post length rather than maxed out
  linkedin: 3000,
  'linkedin-page': 3000,
  nostr: 2000, // relay-dependent, no universal hard cap — conservative default
  youtube: 5000, // description field
  dribbble: 500, // no dedicated description field — shares the title's small budget
  medium: 20000,
  devto: 20000,
  wordpress: 20000, // WordpressProvider.post()'s maxLength() is 100000; kept well under it for a sane post length
};
const DEFAULT_BODY_LIMIT = 2000;

export interface PostCopyInput {
  caption: string;
  title?: string | null;
  prompt?: string | null;
}

export interface GeneratedCopy {
  title: string;
  /** A short, original, exciting marketing sentence promoting the app (e.g. "Wow! You can create videos like this with Vantly UGC...") — composeDescription() below builds every network's actual body around this. */
  hook: string;
  tags: string[];
}

const EMPTY_COPY: GeneratedCopy = { title: '', hook: '', tags: [] };

const SYSTEM_PROMPT = `You write marketing copy for a post publicizing a video made by an AI video app (vantly-ugc.com, published via vantly.social), from its caption and (if given) its original creation prompt or working title. The "working title" you're given is often actually the video's full script or lyrics, not a real title - never copy it, the caption, or the prompt verbatim into TITLE or HOOK; always write new, original, short text in your own words, however long or short the input is. Output EXACTLY this format, nothing else, no surrounding quotes on any line:
TITLE: <a punchy original title, 3-12 words, never a copy of the input text>
HOOK: <one exciting, original marketing sentence promoting the app - e.g. starting "Wow! You can create videos like this with..." - never a copy of the input>
TAGS: <3-6 short topical hashtag-ready tags, comma separated, no # symbol, lowercase>`;

/**
 * One Anthropic call that derives a title/hook/tags set used to build every
 * network's title (where it has one) and description - called at most once
 * per publish request (see createPost in vantly.ts), never per network.
 *
 * Never throws: a missing/failed model call must not block publishing.
 * Every caller below has its own caption-derived fallback for when this
 * comes back empty.
 */
export async function generateSocialCopy(input: PostCopyInput): Promise<GeneratedCopy> {
  const userMessageParts = [
    input.title ? `Existing working title: ${input.title}` : null,
    `Caption: ${input.caption || '(none)'}`,
    input.prompt ? `Original creation prompt: ${input.prompt}` : null,
    'Write the TITLE/HOOK/TAGS now, in the exact format specified.',
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
    const hookMatch = raw.match(/^HOOK:\s*(.+)$/m);
    const tagsMatch = raw.match(/^TAGS:\s*(.+)$/m);
    const tags = (tagsMatch?.[1] ?? '')
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    return {
      title: stripQuotes(titleMatch?.[1]),
      hook: stripQuotes(hookMatch?.[1]),
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

/** Generic fallback hook for when the model call fails - short, on-brand, never derived from user content so it can't accidentally echo anything malformed (e.g. the promo line, if that's all a blank caption + the checkbox left to work with). */
const FALLBACK_HOOK = 'Check out this AI-generated video!';

function truncateAtWordBoundary(s: string, max: number): string {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  if (max <= 1) return t.slice(0, Math.max(max, 0));
  const cut = t.slice(0, max - 1); // leave room for the ellipsis
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function buildHashtagString(tags: string[]): string {
  return tags
    .map((t) => `#${t.trim().replace(/[^a-z0-9_]/gi, '')}`)
    .filter((t) => t.length > 1)
    .join(' ');
}

/**
 * Composes the marketing description every network's post body is built
 * around: an optional user-typed caption, the AI hook sentence, what
 * prompt made the video, and hashtags — clamped to `limit` characters by
 * dropping/truncating the LOWEST-priority part first, never by cutting the
 * hook (the actual marketing message) mid-sentence.
 *
 * Priority (highest to lowest): user caption > hook > hashtags > "prompt
 * used" line. On every network this app supports (280 chars and up) the
 * hook + hashtags comfortably fit; the prompt-used line is the one most
 * likely to get shortened or dropped on the tightest limits (X, Dribbble).
 */
function composeDescription(
  args: { userCaption: string; hook: string; prompt?: string | null; tags: string[] },
  limit: number,
): string {
  const hook = (args.hook || '').trim() || FALLBACK_HOOK;
  const userCaption = (args.userCaption || '').trim();
  const hashtags = buildHashtagString(args.tags);

  const base = [userCaption, hook].filter(Boolean).join('\n\n');
  const withTags = hashtags ? `${base}\n\n${hashtags}` : base;

  if (args.prompt && args.prompt.trim()) {
    const promptText = args.prompt.trim().replace(/\s+/g, ' ');
    const prefix = 'Prompt used: "';
    const suffix = '"';
    const reserved = withTags.length + 2 + prefix.length + suffix.length; // +2 for the joining blank line
    const room = limit - reserved;
    if (room >= 15) {
      const truncatedPrompt = truncateAtWordBoundary(promptText, room);
      const withPrompt = `${base}\n\nPrompt used: "${truncatedPrompt}"${hashtags ? `\n\n${hashtags}` : ''}`;
      if (withPrompt.length <= limit) return withPrompt;
    }
  }

  if (withTags.length <= limit) return withTags;
  if (base.length <= limit) return base; // drop hashtags before touching the hook/caption
  return truncateAtWordBoundary(base, limit);
}

export interface SettingsContext {
  network: string;
  /** The user's own typed caption, if any - kept as-is, never overwritten by the generated copy. */
  caption: string;
  /** Pre-computed once per publish request by createPost. */
  copy?: GeneratedCopy;
  /** The video's original creation prompt, if known - surfaced in the description as "Prompt used: ...". */
  prompt?: string | null;
  /** Public URL of the uploaded video (from Vantly's own /upload-from-url — a real public URL on Vantly's storage, not a path needing a domain prefix). Only used by buildNetworkContent, for networks that can embed a playable video directly in the post body. */
  mediaUrl?: string;
  /** Whether to append PROMO_LINE as the last line of the body (the "promote my platforms" checkbox). */
  addPromoLinks?: boolean;
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
 * Every network gets the same AI-composed marketing description (the hook
 * + what prompt made the video + hashtags), clamped to that network's real
 * character limit via composeDescription() above — not the bare caption
 * verbatim, which previously meant a network could end up publishing
 * nothing but an empty caption, or (when the promote-my-platforms checkbox
 * was on and the caption box was empty) the promo line alone with nothing
 * else, since the promo line used to be pre-merged into the caption on the
 * frontend and there was no other source of body text.
 *
 * WordPress is further special-cased: it's a full blog post, not a
 * caption, and WordpressProvider.post() (vantly's backend) has NO
 * video-upload support at all — it only ever uploads `settings.main_image`
 * as a featured image. So WordPress gets real HTML: an embedded <video>
 * tag pointing at the video's own public URL (playable directly in the
 * post, since `wp_kses_post` — WordPress's REST API content sanitizer —
 * allows video/source/track tags for any authenticated user, not just
 * admins), followed by the same composed description, one <p> per
 * paragraph.
 */
export function buildNetworkContent(ctx: SettingsContext): string {
  const copy = ctx.copy ?? EMPTY_COPY;
  const limit = PLATFORM_BODY_LIMITS[ctx.network] ?? DEFAULT_BODY_LIMIT;
  // Reserve room for the promo line up front so it's never the part that
  // gets dropped when the description is composed — it's a single short,
  // explicit opt-in from the user, not optional filler.
  const promoReserve = ctx.addPromoLinks ? PROMO_LINE.length + 2 : 0;
  const description = composeDescription(
    { userCaption: ctx.caption, hook: copy.hook, prompt: ctx.prompt, tags: copy.tags },
    Math.max(limit - promoReserve, 40),
  );
  const withPromo = ctx.addPromoLinks ? `${description}\n\n${PROMO_LINE}` : description;

  if (ctx.network !== 'wordpress') return withPromo;

  const videoBlock = ctx.mediaUrl
    ? `<p><video controls preload="metadata" style="max-width:100%;height:auto;" src="${escapeHtml(ctx.mediaUrl)}"></video></p>`
    : '';
  const descriptionBlock = withPromo
    .split('\n\n')
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return [videoBlock, descriptionBlock].filter(Boolean).join('\n') || withPromo;
}

// Networks with genuinely no required settings fields beyond `__type`.
const NO_SETTINGS_NETWORKS = new Set([
  'kick', 'twitch', 'facebook', 'linkedin', 'linkedin-page', 'gmb',
  'threads', 'mastodon', 'bluesky', 'telegram', 'nostr', 'vk',
]);

// Networks whose required settings need a generated title.
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
        subtitle: clampTitle(copy.hook, fallbackTitle, 2, 150),
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
