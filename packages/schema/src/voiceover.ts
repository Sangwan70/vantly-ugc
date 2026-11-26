// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — shared timeline schema + pricing.
 *
 * A Voiceover Studio project takes ONE silent screen recording (e.g. a
 * Wondershare Filmora / OBS capture), lets the user cut it into clips, add
 * zoom/pan + text animations, and lay text-to-speech voice blocks on top
 * (ElevenLabs, platform key or the user's own key). The timeline below is the
 * single contract between the web editor (live preview), api-v2 (validation,
 * quote) and primitive-worker-vnext (ffmpeg render) — all three MUST read it
 * through these schemas so the preview, the quote and the render agree.
 *
 * Time units: seconds. "src" times are positions in the source recording;
 * every other time (voice block start, overlay start/end) is on the OUTPUT
 * timeline, i.e. after cuts and speed changes.
 */

import { z } from 'zod';

const id = z.string().min(1).max(64);
const unit = z.number().min(0).max(1);

export const VoiceoverZoomSchema = z.object({
  /**
   * none  — no motion.
   * in    — ramps 1 → scale across the whole clip (Ken Burns push-in).
   * out   — ramps scale → 1 across the whole clip.
   * focus — eases into `scale` at (x,y), holds, eases back out at the end.
   *         This is the "zoom to the button being clicked" screen-recording move.
   */
  mode: z.enum(['none', 'in', 'out', 'focus']).default('none'),
  scale: z.number().min(1).max(4).default(1.6),
  /** Focus point, 0..1 of the frame. */
  x: unit.default(0.5),
  y: unit.default(0.5),
  /** Ease duration for `focus` (seconds). */
  ease: z.number().min(0).max(5).default(0.6),
});
export type VoiceoverZoom = z.infer<typeof VoiceoverZoomSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const easing = z.enum(['linear', 'ease_in_out', 'ease_in', 'ease_out', 'hold']);
export type VoiceoverEasing = z.infer<typeof easing>;

/** Camera keyframe: at `t` seconds into the clip (output time) the camera is at zoom/x/y. */
export const CameraKeyframeSchema = z.object({
  t: z.number().min(0),
  zoom: z.number().min(1).max(4),
  x: unit,
  y: unit,
  /** Easing used to travel FROM this keyframe to the next one. */
  ease: easing.default('ease_in_out'),
});
export type CameraKeyframe = z.infer<typeof CameraKeyframeSchema>;

export const TRANSITION_KINDS = ['none', 'crossfade', 'fade_black', 'slide_left', 'slide_up', 'zoom', 'wipe'] as const;
export const TransitionSchema = z.object({
  kind: z.enum(TRANSITION_KINDS).default('none'),
  duration: z.number().min(0.1).max(2).default(0.5),
});
export type VoiceoverTransition = z.infer<typeof TransitionSchema>;

/** Title card (intro / outro / chapter) rendered from scratch instead of from the recording. */
export const CardSchema = z.object({
  duration: z.number().min(0.5).max(30).default(3),
  title: z.string().max(120).default(''),
  subtitle: z.string().max(200).default(''),
  bg: hex.default('#0B2E5C'),
  color: hex.default('#FFFFFF'),
  accent: hex.default('#1565C0'),
  logo: z.boolean().default(true),
  animation: z.enum(['fade', 'slide_up', 'pop']).default('slide_up'),
  /**
   * solid = flat bg (as before) · gradient = bg → bg2 diagonal with soft accent
   * shapes · backdrop = a blurred, slowly panning still of the recording at
   * `backdrop_t`, tinted bg → bg2.
   */
  look: z.enum(['solid', 'gradient', 'backdrop']).default('solid'),
  bg2: hex.default('#1565C0'),
  /** Source-recording second the backdrop still is taken from. */
  backdrop_t: z.number().min(0).default(0),
  /** Small label above the title, e.g. "EPISODE 2". */
  eyebrow: z.string().max(60).default(''),
  /** Call-to-action pill under the subtitle, e.g. "theskillpedia.com/courses". */
  pill: z.string().max(80).default(''),
  /**
   * Brand sting played before the card's own content (a logo-reveal video
   * hosted on our storage). The card then dissolves in from its last frame.
   * The clip lasts sting_duration + duration.
   */
  sting_url: z.string().url().nullable().default(null),
  sting_duration: z.number().min(0).max(15).default(0),
});
export type VoiceoverCard = z.infer<typeof CardSchema>;

export const VoiceoverClipSchema = z
  .object({
    id,
    kind: z.enum(['source', 'card']).default('source'),
    src_in: z.number().min(0).default(0),
    src_out: z.number().positive().default(1),
    speed: z.number().min(0.25).max(4).default(1),
    zoom: VoiceoverZoomSchema.default({}),
    /** When present (≥1), the camera follows these keyframes and `zoom` is ignored. */
    keyframes: z.array(CameraKeyframeSchema).max(60).default([]),
    /** Dip-from/to-black fades on this clip (seconds). */
    fade_in: z.number().min(0).max(3).default(0),
    fade_out: z.number().min(0).max(3).default(0),
    /** Transition INTO this clip from the previous one (overlaps both). */
    transition: TransitionSchema.default({}),
    card: CardSchema.optional(),
  })
  .refine((c) => c.kind === 'card' || c.src_out - c.src_in >= 0.1, { message: 'clip must be at least 0.1s long' })
  .refine((c) => c.kind !== 'card' || Boolean(c.card), { message: 'card clip needs card settings' });
export type VoiceoverClip = z.infer<typeof VoiceoverClipSchema>;

export const VoiceSettingsSchema = z.object({
  stability: unit.default(0.5),
  similarity_boost: unit.default(0.75),
  style: unit.default(0),
  use_speaker_boost: z.boolean().default(true),
  speed: z.number().min(0.7).max(1.2).default(1),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const VoiceoverWordSchema = z.object({
  word: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type VoiceoverWord = z.infer<typeof VoiceoverWordSchema>;

export const VoiceBlockSchema = z.object({
  id,
  /** Output-timeline position where this block starts playing. */
  start: z.number().min(0),
  text: z.string().max(5000).default(''),
  voice_id: z.string().max(64).default(''),
  voice_name: z.string().max(120).optional(),
  /** Which ElevenLabs account the voice lives on: ours, or the user's own key. */
  voice_source: z.enum(['platform', 'user', 'workspace']).default('platform'),
  model_id: z.string().max(64).default('eleven_multilingual_v2'),
  settings: VoiceSettingsSchema.default({}),
  volume: z.number().min(0).max(2).default(1),
  /** Filled after generation (POST /v1/studio/tts). */
  audio_url: z.string().url().nullable().default(null),
  audio_duration: z.number().min(0).nullable().default(null),
  take_id: z.string().uuid().nullable().default(null),
  /** Word timings relative to the block start (for captions). */
  words: z.array(VoiceoverWordSchema).max(2000).default([]),
  /** Text the current audio was generated from — lets the UI flag stale audio. */
  generated_text: z.string().max(5000).nullable().default(null),
  /** Voice the current audio was generated with — a voice change also makes it stale. */
  generated_voice_id: z.string().max(120).nullable().default(null),
  /** Play only part of the take (seconds into the audio) — used by split / regenerate-selection. */
  audio_in: z.number().min(0).default(0),
  audio_out: z.number().min(0).nullable().default(null),
  /** Previous generations, newest first, for A/B comparison. */
  takes: z.array(z.object({
    take_id: z.string().uuid(),
    audio_url: z.string().url(),
    audio_duration: z.number().min(0),
    words: z.array(VoiceoverWordSchema).max(2000).default([]),
    text: z.string().max(5000),
    voice_name: z.string().max(120).optional(),
    created_at: z.string().max(40),
  })).max(10).default([]),
  /** Presenter (lip-synced talking head) over this block — generated once per voice take, then reused. */
  presenter: z.object({
    on: z.boolean().default(false),
    clip_url: z.string().url().nullable().default(null),
    /** presenterTakeKey() the clip was made from; any change (new take, trim, photo) marks it stale. */
    clip_key: z.string().max(1200).nullable().default(null),
    /** Generation in flight — the editor polls it and fills clip_url. */
    run_id: z.string().uuid().nullable().default(null),
  }).optional(),
});
export type VoiceBlock = z.infer<typeof VoiceBlockSchema>;

export const TextOverlaySchema = z
  .object({
    id,
    start: z.number().min(0),
    end: z.number().positive(),
    text: z.string().min(1).max(300),
    x: unit.default(0.5),
    y: unit.default(0.12),
    /** Font size in px at a 1080px-tall frame; scaled to the render size. */
    size: z.number().min(12).max(200).default(56),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
    box: z.boolean().default(true),
    box_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0B2E5C'),
    animation: z.enum(['none', 'fade', 'slide_up', 'pop', 'slide_left', 'typewriter']).default('fade'),
    /** text = plain label · lower_third = title + subtitle bar · callout = label with an arrow to (tx,ty). */
    kind: z.enum(['text', 'lower_third', 'callout']).default('text'),
    subtitle: z.string().max(200).default(''),
    tx: unit.default(0.5),
    ty: unit.default(0.5),
    /** Built-in family name or a custom font asset id. */
    font: z.string().max(80).default('Liberation Sans'),
  })
  .refine((o) => o.end > o.start, { message: 'overlay end must be after start' });
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const ASPECTS = ['source', '16:9', '9:16', '1:1'] as const;
export type VoiceoverAspect = (typeof ASPECTS)[number];

export const CaptionStyleSchema = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(['hormozi', 'tiktok', 'minimal']).default('minimal'),
  /** false = use the preset; true = use the fields below. */
  custom: z.boolean().default(false),
  font: z.string().max(80).default('Liberation Sans'),
  size: z.number().min(16).max(160).default(52),
  color: hex.default('#FFFFFF'),
  highlight_color: hex.default('#FFE500'),
  words_per_line: z.number().int().min(1).max(12).default(6),
  position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
  /** Distance from the top/bottom edge, as a fraction of the frame height. */
  margin: z.number().min(0).max(0.45).default(0.08),
  box: z.boolean().default(false),
  box_color: hex.default('#000000'),
  box_opacity: unit.default(0.55),
  uppercase: z.boolean().default(false),
  bold: z.boolean().default(true),
  animation: z.enum(['none', 'karaoke', 'pop', 'fade']).default('none'),
});
export type VoiceoverCaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const VoiceoverOutputSchema = z.object({
  aspect: z.enum(ASPECTS).default('source'),
  /** How the recording sits in a canvas of a different shape. */
  fit: z.enum(['blur', 'black', 'cover']).default('blur'),
  /** Filmora captures are usually silent; 0 drops the original track. */
  original_volume: z.number().min(0).max(2).default(0),
  captions: CaptionStyleSchema.default({}),
  /** draft = 720p fast · standard = 1080p · high = up to 4K, slower encode. */
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  /** Extra shapes rendered in the same job (batch export). */
  extra_aspects: z.array(z.enum(ASPECTS)).max(3).default([]),
});
export type VoiceoverOutput = z.infer<typeof VoiceoverOutputSchema>;

export const VoiceoverSourceSchema = z.object({
  url: z.string().url(),
  duration: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  has_audio: z.boolean().default(false),
});
export type VoiceoverSource = z.infer<typeof VoiceoverSourceSchema>;

export const VOICEOVER_LIMITS = {
  maxClips: 300,
  maxBlocks: 300,
  maxOverlays: 150,
  maxOutputSeconds: 30 * 60,
} as const;

export const EFFECT_KINDS = ['click', 'spotlight', 'highlight', 'arrow', 'blur'] as const;
/**
 * Screen-recording effects, positioned in OUTPUT-frame coordinates (0..1):
 * click     — ripple ring at (x,y)
 * spotlight — dims everything except the w×h box centred on (x,y)
 * highlight — outlined (optionally tinted) box around w×h at (x,y)
 * arrow     — arrow from (from_x,from_y) to (x,y)
 * blur      — pixelates/blurs w×h at (x,y) (redact emails, keys, names)
 */
export const EffectSchema = z
  .object({
    id,
    kind: z.enum(EFFECT_KINDS),
    start: z.number().min(0),
    end: z.number().positive(),
    x: unit.default(0.5),
    y: unit.default(0.5),
    w: z.number().min(0.01).max(1).default(0.2),
    h: z.number().min(0.01).max(1).default(0.12),
    from_x: unit.default(0.3),
    from_y: unit.default(0.3),
    color: hex.default('#FFD400'),
    /** spotlight dim / blur strength / ripple size. */
    intensity: unit.default(0.6),
  })
  .refine((e) => e.end > e.start, { message: 'effect end must be after start' });
export type VoiceoverEffect = z.infer<typeof EffectSchema>;

export const LOUDNESS_TARGETS = { youtube: -14, podcast: -16, broadcast: -23 } as const;

export const VoiceoverAudioSchema = z.object({
  music: z
    .object({
      url: z.string().url(),
      name: z.string().max(200).default('Music'),
      volume: z.number().min(0).max(1.5).default(0.25),
      /** Sidechain-duck the music under narration. */
      duck: z.boolean().default(true),
      /** 0 = no ducking, 1 = music nearly silent under voice. */
      duck_amount: unit.default(0.7),
      fade_in: z.number().min(0).max(10).default(1.5),
      fade_out: z.number().min(0).max(10).default(2.5),
      loop: z.boolean().default(true),
    })
    .nullable()
    .default(null),
  loudness: z.enum(['youtube', 'podcast', 'broadcast', 'off']).default('youtube'),
  /** Short fades on every voice block head/tail so cuts never click. */
  voice_fades: z.boolean().default(true),
});
export type VoiceoverAudio = z.infer<typeof VoiceoverAudioSchema>;

export const VoiceoverBrandingSchema = z.object({
  logo_url: z.string().url().nullable().default(null),
  logo_position: z.enum(['tl', 'tr', 'bl', 'br']).default('tr'),
  /** Logo width as a fraction of the frame width. */
  logo_size: z.number().min(0.03).max(0.4).default(0.1),
  logo_opacity: unit.default(0.85),
  /** Visible "AI-generated voice" badge (disclosure). */
  disclosure_badge: z.boolean().default(false),
  palette: z.array(hex).max(8).default([]),
});
export type VoiceoverBranding = z.infer<typeof VoiceoverBrandingSchema>;

export const PRESENTER_CORNERS = ['auto', 'tl', 'tr', 'bl', 'br'] as const;
export const VoiceoverPresenterSchema = z.object({
  /** The presenter photo every take is made from: your upload, or your upload dressed in `outfit`. */
  photo_url: z.string().url().nullable().default(null),
  /** Your original upload, kept so a new outfit always starts from the real photo. */
  source_url: z.string().url().nullable().default(null),
  /** What you're wearing in photo_url when it was dressed ("a navy blue suit, white shirt and tie"). */
  outfit: z.string().max(200).default(''),
  /** Optional second reference — a frame of you talking (speaking style, setting). */
  style_url: z.string().url().nullable().default(null),
  /** Where you are, for the take ("a bright home office"). Empty = the photo's own setting. */
  scene: z.string().max(200).default(''),
  /** The person in the photo agreed to an AI-generated, lip-synced likeness of themselves. */
  consent: z.boolean().default(false),
  /** auto = the bottom corner away from the logo. */
  corner: z.enum(PRESENTER_CORNERS).default('auto'),
  /** Circle diameter as a fraction of the frame's shorter side. */
  size: z.number().min(0.12).max(0.5).default(0.26),
  ring_color: hex.default('#FFFFFF'),
});
export type VoiceoverPresenter = z.infer<typeof VoiceoverPresenterSchema>;

export const FontAssetSchema = z.object({ id, url: z.string().url(), name: z.string().max(120) });
export type FontAsset = z.infer<typeof FontAssetSchema>;

export const PronunciationSchema = z.object({
  word: z.string().min(1).max(80),
  /** Spoken as this text … */
  alias: z.string().max(120).default(''),
  /** … or this IPA (wins when both are set; supported by fewer models). */
  phoneme: z.string().max(120).default(''),
});
export type VoiceoverPronunciation = z.infer<typeof PronunciationSchema>;

export const VoiceoverTimelineSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).default(2),
  clips: z.array(VoiceoverClipSchema).max(VOICEOVER_LIMITS.maxClips).default([]),
  blocks: z.array(VoiceBlockSchema).max(VOICEOVER_LIMITS.maxBlocks).default([]),
  overlays: z.array(TextOverlaySchema).max(VOICEOVER_LIMITS.maxOverlays).default([]),
  effects: z.array(EffectSchema).max(VOICEOVER_LIMITS.maxOverlays).default([]),
  output: VoiceoverOutputSchema.default({}),
  audio: VoiceoverAudioSchema.default({}),
  branding: VoiceoverBrandingSchema.default({}),
  presenter: VoiceoverPresenterSchema.default({}),
  fonts: z.array(FontAssetSchema).max(10).default([]),
  pronunciations: z.array(PronunciationSchema).max(300).default([]),
});
export type VoiceoverTimeline = z.infer<typeof VoiceoverTimelineSchema>;

// ── Timeline math (shared by preview, quote and render) ────────────────────

/** Seconds of brand sting a card plays before its own content (0 without one). */
export function cardStingLength(card: { sting_url?: string | null; sting_duration?: number } | null | undefined): number {
  return card?.sting_url ? Math.max(0, card.sting_duration ?? 0) : 0;
}

export function clipOutputDuration(c: Pick<VoiceoverClip, 'src_in' | 'src_out' | 'speed'> & { kind?: string; card?: { duration: number; sting_url?: string | null; sting_duration?: number } }): number {
  if (c.kind === 'card') return (c.card?.duration ?? 3) + cardStingLength(c.card);
  return Math.max(0, c.src_out - c.src_in) / (c.speed || 1);
}

type TimelineClips = { clips: Array<Parameters<typeof clipOutputDuration>[0] & { transition?: VoiceoverTransition }> };

/** Seconds clip i overlaps clip i-1 because of its transition. */
export function transitionOverlap(t: TimelineClips, i: number): number {
  if (i <= 0) return 0;
  const tr = t.clips[i].transition;
  if (!tr || tr.kind === 'none') return 0;
  const a = clipOutputDuration(t.clips[i - 1]);
  const b = clipOutputDuration(t.clips[i]);
  return Math.max(0, Math.min(tr.duration, a / 2, b / 2));
}

/** Output-time start of every clip (transitions pull clips earlier). */
export function clipStarts(t: TimelineClips): number[] {
  const out: number[] = [];
  let acc = 0;
  t.clips.forEach((c, i) => {
    acc -= transitionOverlap(t, i);
    out.push(acc);
    acc += clipOutputDuration(c);
  });
  return out;
}

export function timelineDuration(t: TimelineClips): number {
  if (!t.clips.length) return 0;
  const starts = clipStarts(t);
  const last = t.clips.length - 1;
  return starts[last] + clipOutputDuration(t.clips[last]);
}

/**
 * Output time → { clip index, source time }. Inside a transition the incoming
 * clip wins (that is what the preview shows). Null past the end. Card clips
 * report srcT = 0.
 */
export function locateOutputTime(
  t: TimelineClips,
  outT: number,
): { index: number; clipStart: number; srcT: number } | null {
  if (!t.clips.length) return null;
  const starts = clipStarts(t);
  const total = timelineDuration(t);
  if (outT > total + 1e-6 || outT < 0) return null;
  let i = t.clips.length - 1;
  while (i > 0 && outT < starts[i]) i--;
  const c = t.clips[i];
  const local = Math.min(Math.max(0, outT - starts[i]), clipOutputDuration(c));
  return { index: i, clipStart: starts[i], srcT: c.kind === 'card' ? 0 : c.src_in + local * (c.speed || 1) };
}

/** Captions source: every generated block's words placed on the output timeline. */
export function timelineWords(t: Pick<VoiceoverTimeline, 'blocks'>): VoiceoverWord[] {
  const out: VoiceoverWord[] = [];
  for (const b of t.blocks) {
    if (!b.audio_url) continue;
    const a0 = b.audio_in ?? 0;
    const a1 = b.audio_out ?? Infinity;
    for (const w of b.words) {
      if (w.start < a0 - 0.01 || w.start >= a1) continue;
      out.push({ word: w.word, start: b.start + w.start - a0, end: b.start + Math.min(w.end, a1) - a0 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ── Pricing (credits) ──────────────────────────────────────────────────────
// 68 credits ≈ $1 (see credits.ts). ElevenLabs list price is ~$0.18–0.30 per
// 1k characters; 20 credits / 1k chars keeps margin at the top of that range.
export const VOICEOVER_TTS_CREDITS_PER_1K_CHARS = 20;
export const VOICEOVER_TTS_MIN_CREDITS = 1;
// Render is CPU-only ffmpeg; priced per started output minute.
export const VOICEOVER_RENDER_CREDITS_PER_MINUTE = 6;
export const VOICEOVER_RENDER_MIN_CREDITS = 6;

export function quoteVoiceoverTtsCredits(chars: number): number {
  return Math.max(VOICEOVER_TTS_MIN_CREDITS, Math.ceil((chars / 1000) * VOICEOVER_TTS_CREDITS_PER_1K_CHARS));
}

export const VOICEOVER_QUALITY_MULTIPLIER = { draft: 0.5, standard: 1, high: 2 } as const;

export function quoteVoiceoverRenderCredits(
  outputSeconds: number,
  opts?: { quality?: keyof typeof VOICEOVER_QUALITY_MULTIPLIER; formats?: number },
): number {
  const perFormat = Math.max(
    VOICEOVER_RENDER_MIN_CREDITS,
    Math.ceil(Math.ceil(outputSeconds / 60) * VOICEOVER_RENDER_CREDITS_PER_MINUTE * VOICEOVER_QUALITY_MULTIPLIER[opts?.quality ?? 'standard']),
  );
  return perFormat * Math.max(1, opts?.formats ?? 1);
}

// Presenter takes are Seedance 2.0 reference-to-video, billed per second (4–15 s)
// with the real-person filter relaxed (1.1×): ~$0.22/s at 720p, so 31 credits/s
// keeps the same ~50% margin as selfie clips.
export const PRESENTER_CREDITS_PER_SECOND = 31;
export const PRESENTER_MIN_SECONDS = 4;
export const PRESENTER_MAX_SECONDS = 15;

/** Seconds a presenter take is generated (and billed) for: the block's played audio, rounded up, 4–15. */
export function presenterTakeSeconds(audioSeconds: number): number {
  return Math.min(PRESENTER_MAX_SECONDS, Math.max(PRESENTER_MIN_SECONDS, Math.ceil(audioSeconds - 1e-6)));
}

export function quotePresenterCredits(audioSeconds: number): number {
  return presenterTakeSeconds(audioSeconds) * PRESENTER_CREDITS_PER_SECOND;
}

/** Every shape a render produces (primary first, de-duplicated). */
export function renderAspects(o: Pick<VoiceoverOutput, 'aspect' | 'extra_aspects'>): VoiceoverAspect[] {
  return [...new Set([o.aspect, ...(o.extra_aspects ?? [])])];
}

/** Caption parameters after applying the preset (when custom = false). */
export function resolveCaptionStyle(c: VoiceoverCaptionStyle): Omit<VoiceoverCaptionStyle, 'enabled' | 'style' | 'custom'> {
  if (c.custom) return c;
  const base = { ...c };
  if (c.style === 'hormozi') return { ...base, size: 80, color: '#FFFFFF', highlight_color: '#FFFF00', words_per_line: 3, position: 'top', margin: 0.1, box: false, uppercase: true, bold: true, animation: 'karaoke' };
  if (c.style === 'tiktok') return { ...base, size: 64, color: '#FFFFFF', words_per_line: 5, position: 'bottom', margin: 0.11, box: true, box_color: '#000000', box_opacity: 0.55, uppercase: false, bold: true, animation: 'none' };
  return { ...base, size: 52, color: '#FFFFFF', words_per_line: 6, position: 'bottom', margin: 0.07, box: false, uppercase: false, bold: false, animation: 'none' };
}

/** Group caption words into on-screen lines (shared by preview and render). */
export function captionLines(words: VoiceoverWord[], perLine: number): { start: number; end: number; words: VoiceoverWord[] }[] {
  const lines: { start: number; end: number; words: VoiceoverWord[] }[] = [];
  let cur: VoiceoverWord[] = [];
  const flush = () => { if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; };
  for (const w of words) {
    // New line on the word budget, on a pause > 0.6s, or after sentence punctuation.
    if (cur.length && (cur.length >= perLine || w.start - cur[cur.length - 1].end > 0.6)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.word)) flush();
  }
  flush();
  return lines;
}

// ── API payloads ───────────────────────────────────────────────────────────

export const StudioTtsRequestSchema = z.object({
  project_id: z.string().uuid(),
  block_id: id,
  text: z.string().trim().min(1).max(5000),
  voice_id: z.string().min(1).max(64),
  voice_source: z.enum(['platform', 'user', 'workspace']).default('platform'),
  model_id: z.string().min(1).max(64).default('eleven_multilingual_v2'),
  settings: VoiceSettingsSchema.default({}),
  /** Neighbouring block text so consecutive blocks keep the same prosody. */
  previous_text: z.string().max(2000).optional(),
  next_text: z.string().max(2000).optional(),
  language_code: z.string().min(2).max(5).optional(),
});
export type StudioTtsRequest = z.infer<typeof StudioTtsRequestSchema>;

export const VoiceoverRenderInputSchema = z.object({
  project_id: z.string().uuid(),
  source: VoiceoverSourceSchema,
  timeline: VoiceoverTimelineSchema,
  /** Provenance written into the MP4 + manifest (AI disclosure). */
  provenance: z
    .object({
      title: z.string().max(200).default(''),
      voices: z.array(z.object({ voice_id: z.string(), name: z.string().optional(), source: z.string(), consent_id: z.string().nullable().optional() })).max(50).default([]),
      workspace_id: z.string().uuid().nullable().default(null),
      approved_by: z.string().nullable().default(null),
    })
    .default({}),
  /** Data-residency region key (STUDIO_STORAGE_REGIONS); null = default bucket. */
  storage_region: z.string().max(20).nullable().default(null),
  /** Where to POST a JSON notification when the render finishes. */
  webhook_url: z.string().url().nullable().default(null),
  notify_email: z.string().email().nullable().default(null),
});
export type VoiceoverRenderInput = z.infer<typeof VoiceoverRenderInputSchema>;

/** Validation beyond shape: clips inside the source, length cap. Returns error strings. */
export function validateVoiceoverForRender(input: VoiceoverRenderInput): string[] {
  const errs: string[] = [];
  const { source, timeline } = input;
  if (timeline.clips.length === 0) errs.push('timeline has no clips');
  timeline.clips.forEach((c, i) => {
    if (c.kind !== 'card' && c.src_out > source.duration + 0.05) errs.push(`clip ${i + 1} ends after the source video`);
  });
  const dur = timelineDuration(timeline);
  if (dur > VOICEOVER_LIMITS.maxOutputSeconds) errs.push('output is longer than 30 minutes');
  timeline.blocks.forEach((b, i) => {
    if (b.text.trim() && !b.audio_url) errs.push(`voice block ${i + 1} has text but no generated audio`);
    if (b.audio_out !== null && b.audio_out <= b.audio_in) errs.push(`voice block ${i + 1} is trimmed to nothing`);
  });
  return errs;
}

// ── Zoom math (the editor preview mirrors lib/voiceover-ffmpeg.ts zoomFilter) ──

const smoothstep = (p: number) => p * p * (3 - 2 * p);

/** Zoom factor at `localT` seconds (output time) into a clip. */
export function easeValue(e: VoiceoverEasing, p: number): number {
  const q = Math.min(1, Math.max(0, p));
  switch (e) {
    case 'linear': return q;
    case 'ease_in': return q * q;
    case 'ease_out': return 1 - (1 - q) * (1 - q);
    case 'hold': return 0;
    default: return smoothstep(q);
  }
}

/** Camera (zoom + focus point) at `localT`, from keyframes. */
export function cameraAt(keyframes: CameraKeyframe[], localT: number): { zoom: number; x: number; y: number } {
  const kf = [...keyframes].sort((a, b) => a.t - b.t);
  if (!kf.length) return { zoom: 1, x: 0.5, y: 0.5 };
  if (localT <= kf[0].t) return { zoom: kf[0].zoom, x: kf[0].x, y: kf[0].y };
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i];
    const b = kf[i + 1];
    if (localT < b.t) {
      const e = easeValue(a.ease, (localT - a.t) / Math.max(1e-6, b.t - a.t));
      return { zoom: a.zoom + (b.zoom - a.zoom) * e, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
    }
  }
  const l = kf[kf.length - 1];
  return { zoom: l.zoom, x: l.x, y: l.y };
}

/** Full camera state for a clip: keyframes win over the simple zoom mode. */
export function clipCameraAt(clip: Pick<VoiceoverClip, 'src_in' | 'src_out' | 'speed' | 'zoom' | 'keyframes'> & { kind?: string; card?: { duration: number } }, localT: number): { zoom: number; x: number; y: number } {
  if (clip.keyframes?.length) return cameraAt(clip.keyframes, localT);
  return { zoom: zoomAt(clip, localT), x: clip.zoom.x, y: clip.zoom.y };
}

export function zoomAt(clip: Pick<VoiceoverClip, 'src_in' | 'src_out' | 'speed' | 'zoom'> & { kind?: string; card?: { duration: number } }, localT: number): number {
  const z = clip.zoom;
  if (!z || z.mode === 'none' || z.scale <= 1.001) return 1;
  const d = clipOutputDuration(clip);
  if (z.mode === 'in') return 1 + (z.scale - 1) * smoothstep(Math.min(Math.max(localT / d, 0), 1));
  if (z.mode === 'out') return z.scale - (z.scale - 1) * smoothstep(Math.min(Math.max(localT / d, 0), 1));
  const e = Math.min(z.ease, d / 2);
  if (e <= 0) return z.scale;
  const p = Math.max(0, Math.min(localT / e, (d - localT) / e, 1));
  return 1 + (z.scale - 1) * smoothstep(p);
}

/** Top-left of the visible window (in frame units, 0..1) for a zoom around a focus point. */
export function zoomWindow(zoom: number, fx: number, fy: number): { x: number; y: number; size: number } {
  const size = 1 / zoom;
  const clamp = (v: number) => Math.max(0, Math.min(1 - size, v));
  return { x: clamp(fx - size / 2), y: clamp(fy - size / 2), size };
}

/** Seconds of audio a block actually plays (after audio_in/audio_out trims). */
export function blockAudioLength(b: Pick<VoiceBlock, 'audio_duration' | 'audio_in' | 'audio_out'>): number {
  const full = b.audio_duration ?? 0;
  const end = b.audio_out === null || b.audio_out === undefined ? full : Math.min(b.audio_out, full);
  return Math.max(0, end - (b.audio_in ?? 0));
}

// ── Presenter (shared by the editor, api-v2 and the render) ─────────────────

type PresenterBlock = Pick<VoiceBlock, 'start' | 'take_id' | 'audio_url' | 'audio_duration' | 'audio_in' | 'audio_out' | 'presenter'>;
type PresenterLook = Pick<VoiceoverPresenter, 'photo_url' | 'style_url' | 'scene'>;

/** Shape of a take: a 1:1 corner circle over the recording, or the whole frame over a title card. */
export const PRESENTER_FRAMES = ['1:1', '16:9', '9:16'] as const;
export type PresenterFrame = (typeof PRESENTER_FRAMES)[number];

/** Full frame (in the primary shape) when the block starts on a title card; the corner circle otherwise. */
export function presenterFrame(t: Pick<VoiceoverTimeline, 'clips' | 'output'>, b: Pick<VoiceBlock, 'start'>): PresenterFrame {
  const starts = clipStarts(t);
  const onCard = t.clips.some((c, i) => c.kind === 'card' && b.start >= starts[i] - 0.05 && b.start < starts[i] + clipOutputDuration(c));
  if (!onCard) return '1:1';
  return t.output.aspect === '9:16' ? '9:16' : t.output.aspect === '1:1' ? '1:1' : '16:9';
}

/** Cache key of a take: same voice take, trim, photo, setting and frame → the same clip, never paid twice. */
export function presenterTakeKey(b: Pick<VoiceBlock, 'take_id' | 'audio_in' | 'audio_out'>, p: PresenterLook, frame: PresenterFrame = '1:1'): string | null {
  if (!b.take_id || !p.photo_url) return null;
  const key = [b.take_id, b.audio_in.toFixed(2), b.audio_out === null ? '' : b.audio_out.toFixed(2), p.photo_url, p.style_url ?? '', p.scene.trim()];
  return (frame === '1:1' ? key : [...key, frame]).join('|');
}

/** Why this block can't get a presenter take yet (null = it can). */
export function presenterBlockProblem(b: PresenterBlock, p: VoiceoverPresenter): string | null {
  if (!p.photo_url) return 'Add your photo in Style → Presenter';
  if (!p.consent) return 'Confirm consent in Style → Presenter';
  if (!b.audio_url || !b.take_id) return 'Generate the voice first';
  const len = blockAudioLength(b);
  if (len > PRESENTER_MAX_SECONDS) return `Longer than ${PRESENTER_MAX_SECONDS}s — split the block`;
  if (len < 1) return 'Too short for a presenter take';
  return null;
}

/** The clip to show over a block: only when it's on and was made from the block's current take, in this frame. */
export function presenterClipFor(b: PresenterBlock, p: PresenterLook, frame: PresenterFrame = '1:1'): string | null {
  if (!b.presenter?.on || !b.presenter.clip_url) return null;
  return b.presenter.clip_key === presenterTakeKey(b, p, frame) ? b.presenter.clip_url : null;
}

/** Resolved corner: 'auto' sits bottom-right, or bottom-left when the logo is there. */
export function presenterCorner(p: Pick<VoiceoverPresenter, 'corner'>, logoPosition: VoiceoverBranding['logo_position']): 'tl' | 'tr' | 'bl' | 'br' {
  if (p.corner !== 'auto') return p.corner;
  return logoPosition === 'br' ? 'bl' : 'br';
}

/** Worker input for one presenter take (api-v2 → voiceoverPresenterWorkflow). */
export const VoiceoverPresenterTakeInputSchema = z.object({
  project_id: z.string().uuid(),
  block_id: id,
  photo_url: z.string().url(),
  style_url: z.string().url().nullable().default(null),
  scene: z.string().max(200).default(''),
  /** The block's voice take and the part of it that plays. */
  audio_url: z.string().url(),
  audio_in: z.number().min(0).default(0),
  audio_length: z.number().min(0.5).max(PRESENTER_MAX_SECONDS),
  clip_key: z.string().max(1200),
  /** 1:1 for the corner circle; the output shape for a full-frame take over a title card. */
  frame: z.enum(PRESENTER_FRAMES).default('1:1'),
  storage_region: z.string().max(20).nullable().default(null),
  /** Counts toward this workspace's Studio budget. */
  workspace_id: z.string().uuid().nullable().default(null),
});
export type VoiceoverPresenterTakeInput = z.infer<typeof VoiceoverPresenterTakeInputSchema>;

/** Worker input for dressing the presenter photo (api-v2 → voiceoverPresenterLookWorkflow). */
export const VoiceoverPresenterLookInputSchema = z.object({
  project_id: z.string().uuid(),
  /** The original upload (never a previous outfit, so the face doesn't drift). */
  source_url: z.string().url(),
  outfit: z.string().trim().min(3).max(200),
  scene: z.string().max(200).default(''),
  storage_region: z.string().max(20).nullable().default(null),
  workspace_id: z.string().uuid().nullable().default(null),
});
export type VoiceoverPresenterLookInput = z.infer<typeof VoiceoverPresenterLookInputSchema>;

// ── Smart-edit suggestions (shared by the editor and automation) ────────────

export interface EditSuggestionLike {
  id: string;
  kind: 'focus' | 'speed' | 'cut' | 'split' | 'click';
  /** Source-recording seconds. */
  start: number;
  end: number;
  x?: number;
  y?: number;
  zoom?: number;
  speed?: number;
}

const sid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** Source time → output time (first source clip that contains it), or null if cut. */
export function sourceToOutput(t: Pick<VoiceoverTimeline, 'clips'>, srcT: number): { index: number; out: number; local: number } | null {
  const starts = clipStarts(t);
  for (let i = 0; i < t.clips.length; i++) {
    const c = t.clips[i];
    if (c.kind === 'card') continue;
    if (srcT >= c.src_in - 1e-6 && srcT < c.src_out) {
      const local = (srcT - c.src_in) / c.speed;
      return { index: i, out: starts[i] + local, local };
    }
  }
  return null;
}

/** Split camera keyframes at a clip-local time; both halves keep the camera continuous. */
export function splitKeyframes(kf: CameraKeyframe[], at: number): [CameraKeyframe[], CameraKeyframe[]] {
  if (!kf.length) return [[], []];
  const sorted = [...kf].sort((a, b) => a.t - b.t);
  const mid = cameraAt(sorted, at);
  const easeAt = [...sorted].reverse().find((k) => k.t <= at)?.ease ?? 'ease_in_out';
  const left = [...sorted.filter((k) => k.t < at - 1e-6), { t: at, ...mid, ease: easeAt }];
  const right = [{ t: 0, ...mid, ease: easeAt }, ...sorted.filter((k) => k.t > at + 1e-6).map((k) => ({ ...k, t: k.t - at }))];
  return [left, right];
}

/** Split the source clip containing srcT at srcT. Returns the new timeline. */
export function splitAtSource(t: VoiceoverTimeline, srcT: number): VoiceoverTimeline {
  const hit = sourceToOutput(t, srcT);
  if (!hit) return t;
  const c = t.clips[hit.index];
  if (srcT - c.src_in < 0.1 || c.src_out - srcT < 0.1) return t;
  const [kl, kr] = splitKeyframes(c.keyframes, hit.local);
  const left = { ...c, src_out: srcT, fade_out: 0, keyframes: kl };
  const right = { ...c, id: sid('c'), src_in: srcT, fade_in: 0, keyframes: kr, transition: { kind: 'none' as const, duration: 0.5 } };
  const clips = [...t.clips];
  clips.splice(hit.index, 1, left, right);
  return { ...t, clips };
}

/** Shift everything on the output timeline after `from` by `delta` seconds. */
function shiftAfter(t: VoiceoverTimeline, from: number, delta: number): VoiceoverTimeline {
  const sh = (x: number) => (x >= from ? Math.max(from, x + delta) : x);
  return {
    ...t,
    blocks: t.blocks.map((b) => ({ ...b, start: sh(b.start) })),
    overlays: t.overlays.map((o) => ({ ...o, start: sh(o.start), end: sh(o.end) })).filter((o) => o.end - o.start > 0.1),
    effects: t.effects.map((e) => ({ ...e, start: sh(e.start), end: sh(e.end) })).filter((e) => e.end - e.start > 0.05),
  };
}

export function applySuggestion(t: VoiceoverTimeline, s: EditSuggestionLike): VoiceoverTimeline {
  if (s.kind === 'split') return splitAtSource(t, s.start);
  if (s.kind === 'cut' || s.kind === 'speed') {
    let next = splitAtSource(splitAtSource(t, s.start), s.end);
    const a = sourceToOutput(next, s.start + 1e-3);
    if (!a) return t;
    const c = next.clips[a.index];
    if (Math.abs(c.src_in - s.start) > 0.11 && s.start > c.src_in) return t;
    const before = clipOutputDuration(c);
    if (s.kind === 'cut') {
      if (next.clips.length <= 1) return t;
      const start = clipStarts(next)[a.index];
      next = { ...next, clips: next.clips.filter((_, i) => i !== a.index) };
      return shiftAfter(next, start + before, -before);
    }
    const speed = Math.max(0.25, Math.min(4, s.speed ?? 2));
    const after = (c.src_out - c.src_in) / speed;
    const start = clipStarts(next)[a.index];
    next = { ...next, clips: next.clips.map((x, i) => (i === a.index ? { ...x, speed } : x)) };
    return shiftAfter(next, start + before, after - before);
  }
  if (s.kind === 'focus') {
    const a = sourceToOutput(t, s.start);
    if (!a) return t;
    const c = t.clips[a.index];
    const d = clipOutputDuration(c);
    const t0 = Math.max(0, a.local);
    const t1 = Math.min(d, (Math.min(s.end, c.src_out) - c.src_in) / c.speed);
    if (t1 - t0 < 0.5) return t;
    const z = Math.max(1.1, Math.min(4, s.zoom ?? 1.8));
    const x = s.x ?? 0.5;
    const y = s.y ?? 0.5;
    const ramp = Math.min(0.6, (t1 - t0) / 3);
    const base = c.keyframes.length ? c.keyframes : [{ t: 0, zoom: 1, x: 0.5, y: 0.5, ease: 'ease_in_out' as const }];
    const prev = cameraAt(base, t0);
    const added: CameraKeyframe[] = [
      { t: t0, ...prev, ease: 'ease_in_out' },
      { t: t0 + ramp, zoom: z, x, y, ease: 'hold' },
      { t: Math.max(t0 + ramp, t1 - ramp), zoom: z, x, y, ease: 'ease_in_out' },
      { t: Math.min(d, t1 + ramp), zoom: 1, x: 0.5, y: 0.5, ease: 'ease_in_out' },
    ];
    const kept = base.filter((k) => k.t < t0 - 0.05 || k.t > t1 + ramp + 0.05);
    const keyframes = [...kept, ...added].sort((p, q) => p.t - q.t).slice(0, 60);
    return { ...t, clips: t.clips.map((x2, i) => (i === a.index ? { ...x2, keyframes } : x2)) };
  }
  if (s.kind === 'click') {
    const a = sourceToOutput(t, s.start);
    if (!a || s.x === undefined || s.y === undefined) return t;
    const cam = clipCameraAt(t.clips[a.index], a.local);
    const win = zoomWindow(cam.zoom, cam.x, cam.y);
    const x = (s.x - win.x) / win.size;
    const y = (s.y - win.y) / win.size;
    if (x < 0 || x > 1 || y < 0 || y > 1) return t;
    const effect = EffectSchema.parse({ id: sid('fx'), kind: 'click', start: a.out, end: a.out + 0.7, x, y, color: '#FF3B30', intensity: 0.5 });
    return { ...t, effects: [...t.effects, effect] };
  }
  return t;
}

/** Apply many suggestions safely: structure (cuts/speed) last-to-first, then camera, then clicks. */
export function applySuggestions(t: VoiceoverTimeline, suggestions: EditSuggestionLike[], kinds: Array<EditSuggestionLike['kind']>): VoiceoverTimeline {
  const want = new Set(kinds);
  let next = t;
  const structural = suggestions.filter((s) => (s.kind === 'cut' || s.kind === 'speed') && want.has(s.kind)).sort((a, b) => b.start - a.start);
  for (const s of structural) next = applySuggestion(next, s);
  for (const s of suggestions.filter((x) => x.kind === 'focus' && want.has('focus'))) next = applySuggestion(next, s);
  for (const s of suggestions.filter((x) => x.kind === 'click' && want.has('click'))) next = applySuggestion(next, s);
  return next;
}

// ── Narration scripts (cue sheet / SRT / plain), shared by editor + automation ──

/** ~150 words/min ≈ 14 characters/s of narration (same pace as the cue sheets). */
export const NARRATION_CHARS_PER_SECOND = 14;

export interface NarrationCue { start: number | null; text: string }

function parseClockValue(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!/^(\d+:){1,2}\d+(\.\d+)?$/.test(v)) return null;
  return v.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Accepts three shapes:
 *   1. ElevenLabs cue sheet — "CUE 3  |  start 0:28.5  |  max 9.4s" + text lines
 *   2. SRT                   — numbered blocks with "00:00:01,000 --> …"
 *   3. Plain script          — paragraphs separated by blank lines
 */
export function parseNarrationScript(raw: string): NarrationCue[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  if (/^CUE\s+\d+\s*\|/im.test(text)) {
    const cues: NarrationCue[] = [];
    const chunks = text.split(/^(?=CUE\s+\d+\s*\|)/im);
    for (const ch of chunks) {
      const m = /^CUE\s+\d+\s*\|\s*start\s+([\d:.,]+)([^\n]*)(?:\n([\s\S]*))?$/i.exec(ch.trim());
      if (!m) continue;
      // Text may follow the header on the same line ("CUE 1 | start 0:00 | Hello"),
      // after metadata fields such as "max 9.4s", or on the lines below it.
      const inline = m[2].split('|').map((f) => f.trim()).filter((f) => f && !/^(max|end|duration|voice|speaker)\b/i.test(f)).join(' ');
      const text = [inline, (m[3] ?? '').trim()].filter(Boolean).join(' ').replace(/\s*\n\s*/g, ' ');
      if (text) cues.push({ start: parseClockValue(m[1]), text });
    }
    if (cues.length) return cues;
  }
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text)) {
    return text
      .split(/\n\s*\n/)
      .map((chunk) => {
        const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
        const ti = lines.findIndex((l) => l.includes('-->'));
        if (ti < 0) return null;
        return { start: parseClockValue(lines[ti].split('-->')[0]), text: lines.slice(ti + 1).join(' ') };
      })
      .filter((c): c is NarrationCue => Boolean(c && c.text));
  }
  return text
    .split(/\n\s*\n/)
    .map((p) => ({ start: null, text: p.replace(/\s*\n\s*/g, ' ').trim() }))
    .filter((c) => c.text);
}

/** Seconds a block occupies: real audio once generated, otherwise an estimate from its text. */
export function blockPlayLength(b: Pick<VoiceBlock, 'audio_url' | 'audio_duration' | 'audio_in' | 'audio_out' | 'text'>): number {
  if (b.audio_url && b.audio_duration) return blockAudioLength(b);
  return Math.max(0.8, b.text.replace(/<[^>]*>/g, '').trim().length / NARRATION_CHARS_PER_SECOND);
}

/** Push blocks right so none overlaps the one before it (keeps a small breath). */
export function autoSpaceTimelineBlocks<T extends Pick<VoiceoverTimeline, 'blocks'>>(t: T, gap = 0.25): T {
  const blocks = [...t.blocks].sort((a, b) => a.start - b.start);
  let end = 0;
  const out = blocks.map((b, i) => {
    const start = i === 0 ? b.start : Math.max(b.start, end + gap);
    end = start + blockPlayLength(b);
    return { ...b, start };
  });
  return { ...t, blocks: out };
}
