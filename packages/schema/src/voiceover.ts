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

export const VoiceoverClipSchema = z
  .object({
    id,
    src_in: z.number().min(0),
    src_out: z.number().positive(),
    speed: z.number().min(0.25).max(4).default(1),
    zoom: VoiceoverZoomSchema.default({}),
    /** Dip-from/to-black fades on this clip (seconds). */
    fade_in: z.number().min(0).max(3).default(0),
    fade_out: z.number().min(0).max(3).default(0),
  })
  .refine((c) => c.src_out - c.src_in >= 0.1, { message: 'clip must be at least 0.1s long' });
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
  voice_source: z.enum(['platform', 'user']).default('platform'),
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
    animation: z.enum(['none', 'fade', 'slide_up', 'pop']).default('fade'),
  })
  .refine((o) => o.end > o.start, { message: 'overlay end must be after start' });
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const VoiceoverOutputSchema = z.object({
  aspect: z.enum(['source', '16:9', '9:16', '1:1']).default('source'),
  /** How the recording sits in a canvas of a different shape. */
  fit: z.enum(['blur', 'black', 'cover']).default('blur'),
  /** Filmora captures are usually silent; 0 drops the original track. */
  original_volume: z.number().min(0).max(2).default(0),
  captions: z
    .object({
      enabled: z.boolean().default(true),
      style: z.enum(['hormozi', 'tiktok', 'minimal']).default('minimal'),
    })
    .default({}),
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

export const VoiceoverTimelineSchema = z.object({
  version: z.literal(1).default(1),
  clips: z.array(VoiceoverClipSchema).max(VOICEOVER_LIMITS.maxClips).default([]),
  blocks: z.array(VoiceBlockSchema).max(VOICEOVER_LIMITS.maxBlocks).default([]),
  overlays: z.array(TextOverlaySchema).max(VOICEOVER_LIMITS.maxOverlays).default([]),
  output: VoiceoverOutputSchema.default({}),
});
export type VoiceoverTimeline = z.infer<typeof VoiceoverTimelineSchema>;

// ── Timeline math (shared by preview, quote and render) ────────────────────

export function clipOutputDuration(c: Pick<VoiceoverClip, 'src_in' | 'src_out' | 'speed'>): number {
  return Math.max(0, c.src_out - c.src_in) / (c.speed || 1);
}

export function timelineDuration(t: Pick<VoiceoverTimeline, 'clips'>): number {
  return t.clips.reduce((s, c) => s + clipOutputDuration(c), 0);
}

/** Output time → { clip index, source time }. Null past the end. */
export function locateOutputTime(
  t: Pick<VoiceoverTimeline, 'clips'>,
  outT: number,
): { index: number; clipStart: number; srcT: number } | null {
  let acc = 0;
  for (let i = 0; i < t.clips.length; i++) {
    const c = t.clips[i];
    const d = clipOutputDuration(c);
    if (outT < acc + d || i === t.clips.length - 1) {
      const local = Math.min(Math.max(0, outT - acc), d);
      if (outT > acc + d + 1e-6) return null;
      return { index: i, clipStart: acc, srcT: c.src_in + local * (c.speed || 1) };
    }
    acc += d;
  }
  return null;
}

/** Captions source: every generated block's words placed on the output timeline. */
export function timelineWords(t: Pick<VoiceoverTimeline, 'blocks'>): VoiceoverWord[] {
  const out: VoiceoverWord[] = [];
  for (const b of t.blocks) {
    if (!b.audio_url) continue;
    for (const w of b.words) out.push({ word: w.word, start: b.start + w.start, end: b.start + w.end });
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

export function quoteVoiceoverRenderCredits(outputSeconds: number): number {
  return Math.max(
    VOICEOVER_RENDER_MIN_CREDITS,
    Math.ceil(outputSeconds / 60) * VOICEOVER_RENDER_CREDITS_PER_MINUTE,
  );
}

// ── API payloads ───────────────────────────────────────────────────────────

export const StudioTtsRequestSchema = z.object({
  project_id: z.string().uuid(),
  block_id: id,
  text: z.string().trim().min(1).max(5000),
  voice_id: z.string().min(1).max(64),
  voice_source: z.enum(['platform', 'user']).default('platform'),
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
});
export type VoiceoverRenderInput = z.infer<typeof VoiceoverRenderInputSchema>;

/** Validation beyond shape: clips inside the source, length cap. Returns error strings. */
export function validateVoiceoverForRender(input: VoiceoverRenderInput): string[] {
  const errs: string[] = [];
  const { source, timeline } = input;
  if (timeline.clips.length === 0) errs.push('timeline has no clips');
  timeline.clips.forEach((c, i) => {
    if (c.src_out > source.duration + 0.05) errs.push(`clip ${i + 1} ends after the source video`);
  });
  const dur = timelineDuration(timeline);
  if (dur > VOICEOVER_LIMITS.maxOutputSeconds) errs.push('output is longer than 30 minutes');
  timeline.blocks.forEach((b, i) => {
    if (b.text.trim() && !b.audio_url) errs.push(`voice block ${i + 1} has text but no generated audio`);
  });
  return errs;
}

// ── Zoom math (the editor preview mirrors lib/voiceover-ffmpeg.ts zoomFilter) ──

const smoothstep = (p: number) => p * p * (3 - 2 * p);

/** Zoom factor at `localT` seconds (output time) into a clip. */
export function zoomAt(clip: Pick<VoiceoverClip, 'src_in' | 'src_out' | 'speed' | 'zoom'>, localT: number): number {
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
