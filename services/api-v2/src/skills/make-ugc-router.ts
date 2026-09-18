// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * make_ugc — the ONE agent-facing UGC tool. This module is a PURE route
 * decision shared by the run path (skills.ts → dispatchMakeUgc) and the credit
 * quote (credit-quotes.ts) so the price the user confirms can never disagree
 * with what actually runs (the bug class commits 54f47db2 / 587286b6 fixed for
 * b-roll). It adds ZERO generation: it maps the facade props onto an EXISTING
 * skill's body. Identity URLs (uploaded image / looked-up character sheet) are
 * filled in by the run path; here they are placeholders so the quote can be
 * computed with no side effects.
 *
 * `countWords` / `fitDuration` are imported from @vantly-ugc/schema, never
 * reimplemented. This file used to carry private copies; they happened to agree,
 * but nothing enforced it, so a fix to the shared planner would not have reached
 * the route decision — and the route decision is what sets the price.
 */

import { countWords, fitDuration } from '@vantly-ugc/schema';
import { MakeUgcSkillInputSchema, MAKE_UGC_MAX_VARIANTS } from './registry.js';

export interface MakeUgcProps {
  script?: string;
  scene_action?: string;
  person?: string;
  image?: string;
  character?: string;
  product_image?: string;
  name?: string;
  broll_url?: string;
  duration?: 5 | 10 | 15 | 20 | 25 | 30;
  captions?: boolean;
  caption_style?: 'hormozi' | 'tiktok' | 'minimal';
  look?: 'natural' | 'commercial' | 'raw_iphone';
  aspect_ratio?: '9:16' | '1:1';
  /** An ElevenLabs voice id. Resolved (synthesized + uploaded) by the async
   *  run path into a voice_ref_audio_url on the routed body -- never touched
   *  here, since this function stays pure/sync for the shared quote path. */
  voice_id?: string;
  /** BCP-47 language code, used for ElevenLabs synthesis + subtitle language. */
  language?: string;
  /** Optional watermark text. Only threaded through on the make_ugc_video and
   *  make_broll_talking_head routes (see decideMakeUgcRoute) -- the reused-
   *  character and product routes don't have a watermark step yet. */
  watermark_text?: string;
  /** Simple on/off toggle -- the composer's "Background Music" control. */
  background_music?: boolean;
  /** A music direction/genre, e.g. "lo-fi jazz" -- only applied when
   *  background_music is true. The composer's "Music Preference" control. */
  music_preference?: string;
  /** Legacy combined field (boolean or a direction string) some older
   *  callers still send. resolveMusic() prefers background_music /
   *  music_preference when either is set. */
  music?: boolean | string;
}

/** Placeholder for an identity URL the run path resolves before delegating; it
 *  never reaches the underlying schema (the run path overwrites it first). */
export const MAKE_UGC_IDENTITY_PLACEHOLDER = 'https://make-ugc-placeholder.invalid/identity';

/** A description supplied when the caller gives no person/image/character. */
const DEFAULT_PERSON =
  'a friendly, photogenic young person speaking casually to camera, natural daylight, UGC style';

/** Words above which a single Seedance take (≤15s) can't hold the line, so the
 *  multi-take engine (make_broll_talking_head) is used. Mirrors the worker's
 *  fitDuration ceiling (a 15s take tops out at ~33 words). */
const SINGLE_CLIP_MAX_WORDS = 33;

/** A long script needs the multi-take engine: more than one 15s take, or an
 *  explicit `---` intro/moves marker. */
export function isLongScript(script?: string): boolean {
  if (!script) return false;
  if (/(?:^|\n)\s*---\s*(?:\n|$)/.test(script)) return true;
  return countWords(script) > SINGLE_CLIP_MAX_WORDS;
}

/**
 * Compose the friendlier { background_music, music_preference } composer
 * fields (and the legacy `music` field, for older callers) into the single
 * boolean|string shape every underlying skill's `background_music` prop
 * expects. Pure -- used by both the run path and the credit quote.
 */
export function resolveMusic(props: MakeUgcProps): boolean | string | undefined {
  if (typeof props.background_music !== 'undefined') {
    if (props.background_music === false) return false;
    return props.music_preference || true;
  }
  if (props.music_preference) return props.music_preference;
  return props.music;
}

/**
 * Decide which existing skill a make_ugc request routes to and build its body.
 * PURE + sync. `actor_image_url` / `character_sheet_url` / `portrait_url` are
 * placeholders (or a presence sentinel for the quote); the run path fills the
 * real resolved values before the underlying schema validates.
 */
export function decideMakeUgcRoute(props: MakeUgcProps): {
  slug: string;
  body: Record<string, unknown>;
} {
  const hasBroll = Boolean(props.broll_url);
  const hasCharacter = Boolean(props.character);
  const hasImage = Boolean(props.image);
  const hasProduct = Boolean(props.product_image);
  const long = isLongScript(props.script);
  // Captions are OPT-IN: only burned in when the caller explicitly sets
  // captions:true (the agent must ask the user first). Off otherwise.
  const subtitles = props.captions === true;
  const aspect: '9:16' | '1:1' = props.aspect_ratio === '1:1' ? '1:1' : '9:16';

  // Route 0: a product to show/hold/wear → make_product_in_hands (staged in code).
  // Needs a holder (a saved character's sheet) + the product image; both are
  // resolved by dispatchMakeUgc. Placeholders here keep the quote coherent —
  // make_product_in_hands is priced by duration. Product takes precedence.
  if (hasProduct) {
    const body: Record<string, unknown> = {
      character_sheet_url: MAKE_UGC_IDENTITY_PLACEHOLDER, // run path → real sheet
      product_image_url: MAKE_UGC_IDENTITY_PLACEHOLDER, // run path → real product image
      framing: 'close_up',
      aspect_ratio: aspect,
    };
    if (props.script) {
      body.script = props.script;
      body.duration = fitDuration(props.script);
    } else if (props.scene_action) {
      body.scene_action = props.scene_action;
      body.duration = props.duration && [5, 10, 15].includes(props.duration) ? props.duration : 10;
    }
    const productMusic = resolveMusic(props);
    if (typeof productMusic !== 'undefined') body.background_music = productMusic;
    return { slug: 'make_product_in_hands', body };
  }

  // Routes 1 + 2: a b-roll overlay OR a long monologue → make_broll_talking_head,
  // the only engine that turns one script into N seamless ≤15s takes (and, per
  // C1, now runs with NO b-roll). The worker + quote chunk the full script, so a
  // long monologue is rendered in full, never trimmed.
  if (hasBroll || long) {
    return {
      slug: 'make_broll_talking_head',
      body: {
        actor_image_url: MAKE_UGC_IDENTITY_PLACEHOLDER, // run path → real sheet/portrait
        ...(hasBroll ? { broll_video_url: props.broll_url } : {}),
        script: props.script,
        subtitles,
        aspect_ratio: aspect,
        ...(props.watermark_text ? { watermark_text: props.watermark_text } : {}),
        ...(props.language ? { language: props.language.slice(0, 2) } : {}),
        ...(typeof resolveMusic(props) !== 'undefined' ? { background_music: resolveMusic(props) } : {}),
      },
    };
  }

  // Route 3: a short script (or silent clip) with a SAVED character → reuse the
  // sheet via make_simple_selfie (skips the portrait + sheet generation cost).
  // NOTE: the simple_selfie primitive renders a raw selfie with NO captions, so
  // a reused-character short video is always caption-free (consistent with the
  // opt-in default). If a user explicitly wants captions on a reused character,
  // that needs the caption-capable engine — tracked separately, not here.
  if (hasCharacter && (props.script || props.scene_action)) {
    const body: Record<string, unknown> = {
      character_sheet_url: MAKE_UGC_IDENTITY_PLACEHOLDER, // run path → real sheet
      aspect_ratio: aspect,
    };
    if (props.script) {
      body.script = props.script;
      body.duration = fitDuration(props.script);
    } else {
      body.scene_action = props.scene_action;
      body.duration = props.duration && [5, 10, 15].includes(props.duration) ? props.duration : 10;
    }
    const selfieMusic = resolveMusic(props);
    if (typeof selfieMusic !== 'undefined') body.background_music = selfieMusic;
    return { slug: 'make_simple_selfie', body };
  }

  // Route 4 (default): a short script with an image / person description / nothing
  // → make_ugc_video (auto portrait → sheet → selfie → captions).
  const body: Record<string, unknown> = {
    script: props.script ?? '',
    duration: props.script ? fitDuration(props.script) : 10,
    realism_target: props.look ?? 'natural',
    aspect_ratio: aspect,
    subtitles,
    subtitles_style: props.caption_style ?? 'hormozi',
  };
  if (props.name) body.character_description = props.name;
  if (hasImage) {
    // a portrait is provided → the quote skips the portrait-gen cost.
    body.portrait_url = MAKE_UGC_IDENTITY_PLACEHOLDER;
  } else {
    // a person description (or a default) → the quote includes portrait gen.
    body.description = props.person && props.person.length >= 8 ? props.person : DEFAULT_PERSON;
  }
  if (props.watermark_text) body.watermark_text = props.watermark_text;
  if (props.language) body.language = props.language.slice(0, 2);
  const defaultMusic = resolveMusic(props);
  if (typeof defaultMusic !== 'undefined') body.background_music = defaultMusic;
  return { slug: 'make_ugc_video', body };
}


/**
 * Milestone 2, item 2 of the Video Generation Flow audit's 10 Improvements
 * (§6): "a lightweight pre-publish scoring or checklist step ... rules-based
 * check before a video is marked ready: caption readability, hook-in-first-
 * 3-seconds heuristic, duration-vs-platform fit." Deliberately NOT an ML
 * predictor (that's the doc's own stated multi-quarter bet) -- three plain
 * rules, computed from the request alone (no rendered video needed), so it
 * costs nothing and returns instantly at dispatch time rather than waiting
 * on generation.
 */
export interface PrePublishChecklistItem {
  id: 'hook_in_first_3s' | 'caption_readability' | 'duration_platform_fit';
  passed: boolean;
  message: string;
}

export interface PrePublishChecklist {
  passed: number;
  total: number;
  items: PrePublishChecklistItem[];
}

/** Known throat-clearing openers -- flagging KNOWN weak patterns (instead of
 *  requiring a match against some "good hook" template) means a legitimately
 *  creative hook that doesn't fit any pattern is never penalized. */
const WEAK_OPENERS =
  /^(so[,\s]|um[,\s]|uh[,\s]|okay so|ok so|hi (guys|everyone|there)|hey (guys|everyone|there)|welcome back|in this video|today i (want|wanted) to|today we|let me tell you|i wanted to (share|talk)|so today)/i;

/** The speaking pace this pipeline's OWN duration bands already assume
 *  (fitDuration: <=11 words -> 5s, <=22 -> 10s, <=33 -> 15s) -- ~2.2 words/
 *  sec. Used only as the "comfortable" reference in messaging; the
 *  readability check itself flags meaningfully faster than this, not this
 *  exact figure, so scripts that already fit the render pipeline's own
 *  bands are never flagged. */
const COMFORTABLE_WORDS_PER_SECOND = 2.2;
const CAPTION_READABILITY_CEILING_WPS = 3.0;

function firstClause(script: string): string {
  const m = script.trim().match(/^(.*?)(?:[.,!?]|$)/);
  return (m?.[1] ?? script).trim();
}

/**
 * Scores ONE routed request. Pure -- reads only `props` (the caller's
 * make_ugc input) and `routed` (decideMakeUgcRoute's own output), same
 * "no I/O, no side effects" contract as decideMakeUgcRoute itself, so the
 * dispatch route can call it with zero extra cost and the batch path gets
 * it for free per-variant (see dispatchMakeUgc in routes/v1/skills.ts).
 */
export function scorePrePublishChecklist(
  props: MakeUgcProps,
  routed: { slug: string; body: Record<string, unknown> },
): PrePublishChecklist {
  const script = props.script?.trim();
  const items: PrePublishChecklistItem[] = [];

  // 1. Hook in the first ~3 seconds.
  if (script) {
    const opener = firstClause(script);
    const weak = WEAK_OPENERS.test(opener);
    items.push({
      id: 'hook_in_first_3s',
      passed: !weak,
      message: weak
        ? `Opens with "${opener}" — a throat-clearing lead-in. Cut straight to the claim, question, or moment that earns the first 3 seconds.`
        : 'Opens without a known weak/throat-clearing lead-in.',
    });
  } else {
    items.push({
      id: 'hook_in_first_3s',
      passed: true,
      message: 'No dialogue script (silent/scene_action clip) — not applicable.',
    });
  }

  const duration =
    typeof routed.body.duration === 'number'
      ? (routed.body.duration as number)
      : script
      ? Math.max(5, Math.round(countWords(script) / COMFORTABLE_WORDS_PER_SECOND))
      : 10;

  const subtitles =
    typeof routed.body.subtitles === 'boolean' ? (routed.body.subtitles as boolean) : props.captions === true;

  // 2. Caption readability — only meaningful when captions are actually on.
  if (script && subtitles) {
    const wps = countWords(script) / duration;
    const tooFast = wps > CAPTION_READABILITY_CEILING_WPS;
    items.push({
      id: 'caption_readability',
      passed: !tooFast,
      message: tooFast
        ? `~${wps.toFixed(1)} words/sec is faster than comfortable caption reading (aim for ~${COMFORTABLE_WORDS_PER_SECOND}-${CAPTION_READABILITY_CEILING_WPS}) — trim the script or lengthen the take.`
        : `~${wps.toFixed(1)} words/sec — comfortable caption pace.`,
    });
  } else {
    items.push({
      id: 'caption_readability',
      passed: true,
      message: subtitles ? 'No dialogue script — not applicable.' : 'Captions are off for this generation — not applicable.',
    });
  }

  // 3. Duration/aspect fit for the platforms this pipeline publishes to
  // (TikTok / Instagram Reels & Stories / YouTube Shorts — all full-screen
  // vertical, per /dashboard/social's own publish targets).
  const aspect = (routed.body.aspect_ratio as string | undefined) ?? (props.aspect_ratio === '1:1' ? '1:1' : '9:16');
  const squareOnVerticalPlatform = aspect === '1:1';
  items.push({
    id: 'duration_platform_fit',
    passed: !squareOnVerticalPlatform,
    message: squareOnVerticalPlatform
      ? '1:1 fits an Instagram feed post, but TikTok, Reels/Stories and Shorts all play full-screen vertical — 9:16 avoids letterboxing there.'
      : `${aspect} at ${duration}s fits TikTok, Reels/Stories and Shorts.`,
  });

  return { passed: items.filter((i) => i.passed).length, total: items.length, items };
}

/**
 * make_ugc bulk generation ("variants"). Validates every requested variant
 * BEFORE anything is dispatched -- see dispatchMakeUgcBatch in
 * routes/v1/skills.ts for why: an invalid variant discovered partway through
 * a batch would mean some real, billed Temporal workflows already started
 * before the caller finds out a later one was malformed.
 *
 * Each variant is `{...rawBase, ...override}` re-validated from scratch
 * against the FULL MakeUgcSkillInputSchema (not a merge of two already-parsed
 * objects) so zod's own defaulting/refinement logic runs exactly once per
 * variant, the same way it would for an equivalent single-variant request --
 * there is no separate "merge two validated objects" code path to drift from
 * the real one.
 *
 * `rawBase` is the caller's raw request body with `variants` itself removed
 * (never an already-parsed object) precisely so per-variant defaulting
 * happens against what the caller actually sent, not against a
 * previously-defaulted copy.
 */
export interface MakeUgcVariantError {
  variant_index: number;
  detail: unknown;
}

export interface MakeUgcRoutedVariant {
  props: MakeUgcProps;
  routed: { slug: string; body: Record<string, unknown> };
}

export function validateMakeUgcVariants(
  rawBase: Record<string, unknown>,
  overrides: Array<Record<string, unknown>>,
): { ok: true; variants: MakeUgcRoutedVariant[] } | { ok: false; errors: MakeUgcVariantError[] } {
  const errors: MakeUgcVariantError[] = [];
  const variants: MakeUgcRoutedVariant[] = [];
  const capped = overrides.slice(0, MAKE_UGC_MAX_VARIANTS);
  for (let i = 0; i < capped.length; i += 1) {
    const parsed = MakeUgcSkillInputSchema.safeParse({ ...rawBase, ...capped[i] });
    if (!parsed.success) {
      errors.push({ variant_index: i, detail: parsed.error.flatten() });
      continue;
    }
    const props = parsed.data as MakeUgcProps;
    variants.push({ props, routed: decideMakeUgcRoute(props) });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, variants };
}

/**
 * Merges one captured {status, body} into a make_ugc batch's per-run record
 * (see dispatchMakeUgcBatch, routes/v1/skills.ts). Broken out on its own,
 * separate from that route file, specifically so it can be unit-tested
 * without pulling in server.ts's Supabase client construction (which throws
 * without live env vars) -- the same reason validateMakeUgcVariants above
 * lives here rather than in the route file too.
 *
 * The obvious inline version has a real trap: a successful dispatch's own
 * body already carries a `status` field ('submitted') -- spreading it AFTER
 * a `status` key holding the HTTP code would let that string silently
 * clobber the code, which then breaks the succeeded/failed tally in
 * dispatchMakeUgcBatch (a string compared with `< 400` is never true, so
 * every success would misreport as a failure). `http_status` stays a
 * distinct key precisely to avoid that collision.
 */
export function buildBatchRunRecord(
  variantIndex: number,
  captured: { status: number; body: unknown },
): Record<string, unknown> {
  return { variant_index: variantIndex, ...(captured.body as Record<string, unknown>), http_status: captured.status };
}
