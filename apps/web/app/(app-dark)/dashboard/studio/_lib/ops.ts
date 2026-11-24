// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Pure timeline operations for the Voiceover Studio editor. Every edit goes
 * through one of these and returns a NEW timeline (undo/redo keeps snapshots).
 */

import {
  EffectSchema,
  VoiceBlockSchema,
  TextOverlaySchema,
  autoSpaceTimelineBlocks,
  blockPlayLength,
  clipOutputDuration,
  clipStarts as schemaClipStarts,
  locateOutputTime,
  parseNarrationScript,
  splitKeyframes,
  timelineDuration,
  type VoiceBlock,
  type VoiceoverClip,
  type VoiceoverEffect,
  type VoiceoverTimeline,
  type TextOverlay,
} from '@vantly-ugc/schema';

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** ~150 words/min ≈ 14 characters/s of narration (same pace as the cue sheets). */
export const CHARS_PER_SECOND = 14;

export function blockDuration(b: VoiceBlock): number {
  return blockPlayLength(b);
}

export function blockIsStale(b: VoiceBlock): boolean {
  return Boolean(b.audio_url) && b.generated_text !== null && b.generated_text !== b.text;
}

/** Output-time start of every clip (transitions overlap neighbours). */
export function clipStarts(t: VoiceoverTimeline): number[] {
  return schemaClipStarts(t);
}

export function splitAt(t: VoiceoverTimeline, outT: number): { timeline: VoiceoverTimeline; newId: string | null } {
  const loc = locateOutputTime(t, outT);
  if (!loc) return { timeline: t, newId: null };
  const c = t.clips[loc.index];
  if (c.kind === 'card') return { timeline: t, newId: null };
  if (loc.srcT - c.src_in < 0.1 || c.src_out - loc.srcT < 0.1) return { timeline: t, newId: null };
  // Keep the camera continuous across the cut.
  const [kl, kr] = splitKeyframes(c.keyframes, outT - loc.clipStart);
  const left: VoiceoverClip = { ...c, src_out: loc.srcT, fade_out: 0, keyframes: kl };
  const right: VoiceoverClip = { ...c, id: uid('c'), src_in: loc.srcT, fade_in: 0, keyframes: kr, transition: { kind: 'none', duration: 0.5 } };
  const clips = [...t.clips];
  clips.splice(loc.index, 1, left, right);
  return { timeline: { ...t, clips }, newId: right.id };
}

/**
 * Deleting a clip shortens the timeline. Voice blocks and overlays AFTER the
 * removed range shift left with it (ripple) so narration stays on its scene.
 */
export function deleteClip(t: VoiceoverTimeline, id: string): VoiceoverTimeline {
  if (t.clips.length <= 1) return t;
  const idx = t.clips.findIndex((c) => c.id === id);
  if (idx < 0) return t;
  const start = clipStarts(t)[idx];
  const d = clipOutputDuration(t.clips[idx]);
  const shift = (x: number) => (x >= start + d ? x - d : x);
  return {
    ...t,
    clips: t.clips.filter((c) => c.id !== id),
    blocks: t.blocks.map((b) => ({ ...b, start: Math.max(0, shift(b.start)) })),
    overlays: t.overlays
      .map((o) => ({ ...o, start: shift(o.start), end: shift(o.end) }))
      .filter((o) => o.end - o.start > 0.1),
  };
}

export function updateClip(t: VoiceoverTimeline, id: string, patch: Partial<VoiceoverClip>): VoiceoverTimeline {
  return { ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function moveClip(t: VoiceoverTimeline, id: string, dir: -1 | 1): VoiceoverTimeline {
  const i = t.clips.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= t.clips.length) return t;
  const clips = [...t.clips];
  [clips[i], clips[j]] = [clips[j], clips[i]];
  return { ...t, clips };
}

export function newBlock(start: number, defaults: Partial<VoiceBlock>, text = ''): VoiceBlock {
  return VoiceBlockSchema.parse({ id: uid('v'), start: Math.max(0, start), text, ...defaults });
}

export function upsertBlock(t: VoiceoverTimeline, b: VoiceBlock): VoiceoverTimeline {
  const exists = t.blocks.some((x) => x.id === b.id);
  const blocks = exists ? t.blocks.map((x) => (x.id === b.id ? b : x)) : [...t.blocks, b];
  return { ...t, blocks: blocks.sort((a, z) => a.start - z.start) };
}

export function updateBlock(t: VoiceoverTimeline, id: string, patch: Partial<VoiceBlock>): VoiceoverTimeline {
  return { ...t, blocks: t.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)).sort((a, z) => a.start - z.start) };
}

export function deleteBlock(t: VoiceoverTimeline, id: string): VoiceoverTimeline {
  return { ...t, blocks: t.blocks.filter((b) => b.id !== id) };
}

/** Push blocks right so none overlaps the one before it (keeps a small breath). */
export function autoSpaceBlocks(t: VoiceoverTimeline, gap = 0.25): VoiceoverTimeline {
  return autoSpaceTimelineBlocks(t, gap);
}

/** Room until the next block (or the end of the video), like the cue sheet's "max". */
export function blockRoom(t: VoiceoverTimeline, b: VoiceBlock): number {
  const next = t.blocks.filter((x) => x.start > b.start + 1e-6).sort((a, z) => a.start - z.start)[0];
  const limit = next ? next.start : timelineDuration(t);
  return Math.max(0, limit - b.start);
}

export function newEffect(kind: VoiceoverEffect['kind'], start: number, total: number, at?: { x: number; y: number }): VoiceoverEffect {
  const s = Math.max(0, Math.min(start, Math.max(0, total - 0.5)));
  const len = kind === 'click' ? 0.8 : 3;
  return EffectSchema.parse({ id: uid('fx'), kind, start: s, end: Math.min(total || s + len, s + len), ...(at ?? {}) });
}

export function updateEffect(t: VoiceoverTimeline, id: string, patch: Partial<VoiceoverEffect>): VoiceoverTimeline {
  return { ...t, effects: t.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function deleteEffect(t: VoiceoverTimeline, id: string): VoiceoverTimeline {
  return { ...t, effects: t.effects.filter((e) => e.id !== id) };
}

/**
 * Split a generated block at a word boundary WITHOUT regenerating: both halves
 * reference the same take, trimmed with audio_in/audio_out.
 */
export function splitBlockAtChar(t: VoiceoverTimeline, id: string, charIndex: number): { timeline: VoiceoverTimeline; rightId: string | null } {
  const b = t.blocks.find((x) => x.id === id);
  if (!b) return { timeline: t, rightId: null };
  const leftText = b.text.slice(0, charIndex).trimEnd();
  const rightText = b.text.slice(charIndex).trimStart();
  if (!leftText || !rightText) return { timeline: t, rightId: null };
  const right: VoiceBlock = { ...b, id: uid('v'), text: rightText, takes: [] };
  const left: VoiceBlock = { ...b, text: leftText };
  if (b.audio_url && b.words.length && b.generated_text === b.text) {
    // Word index where the right half begins (count words in the left text).
    const nLeft = leftText.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
    const a0 = b.audio_in ?? 0;
    const visible = b.words.filter((w) => w.start >= a0 - 0.01 && (b.audio_out === null || w.start < b.audio_out));
    const cut = visible[nLeft];
    if (cut) {
      const cutT = Math.max(a0, (visible[nLeft - 1]?.end ?? cut.start) + (cut.start - (visible[nLeft - 1]?.end ?? cut.start)) / 2);
      left.audio_out = cutT;
      left.generated_text = leftText;
      right.audio_in = cutT;
      right.audio_out = b.audio_out;
      right.generated_text = rightText;
      right.start = b.start + (cutT - a0);
    } else {
      right.audio_url = null; right.audio_duration = null; right.words = []; right.generated_text = null; right.audio_in = 0; right.audio_out = null;
      right.start = b.start + blockPlayLength(left) + 0.2;
    }
  } else {
    right.audio_url = null; right.audio_duration = null; right.words = []; right.generated_text = null; right.take_id = null; right.audio_in = 0; right.audio_out = null;
    left.audio_url = null; left.audio_duration = null; left.words = []; left.generated_text = null; left.take_id = null; left.audio_in = 0; left.audio_out = null;
    right.start = b.start + blockPlayLength(left) + 0.2;
  }
  return { timeline: { ...t, blocks: t.blocks.map((x) => (x.id === id ? left : x)).concat(right).sort((p, q) => p.start - q.start) }, rightId: right.id };
}

/** Slow down the clips under [start, end) so the video lasts `extra` seconds longer there. */
export function stretchVideoUnder(t: VoiceoverTimeline, start: number, extra: number): VoiceoverTimeline {
  const loc = locateOutputTime(t, start);
  if (!loc || extra <= 0) return t;
  const c = t.clips[loc.index];
  if (c.kind === 'card') return t;
  const d = clipOutputDuration(c);
  const speed = Math.max(0.25, (c.src_out - c.src_in) / (d + extra));
  return { ...t, clips: t.clips.map((x, i) => (i === loc.index ? { ...x, speed: Math.round(speed * 100) / 100 } : x)) };
}

export function newOverlay(start: number, total: number, text = 'Your text'): TextOverlay {
  const s = Math.max(0, Math.min(start, Math.max(0, total - 1)));
  return TextOverlaySchema.parse({ id: uid('t'), start: s, end: Math.min(total || s + 3, s + 3), text });
}

export function updateOverlay(t: VoiceoverTimeline, id: string, patch: Partial<TextOverlay>): VoiceoverTimeline {
  return { ...t, overlays: t.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

export function deleteOverlay(t: VoiceoverTimeline, id: string): VoiceoverTimeline {
  return { ...t, overlays: t.overlays.filter((o) => o.id !== id) };
}

// ── Script import ───────────────────────────────────────────────────────────

export interface ImportedCue { start: number | null; text: string }

function parseClock(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!/^(\d+:){1,2}\d+(\.\d+)?$/.test(v)) return null;
  return v.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

/** Plain script, ElevenLabs cue sheet or SRT → cues (shared parser with automation). */
export function parseScript(raw: string): ImportedCue[] {
  return parseNarrationScript(raw);
}

/** Lay imported cues on the timeline: explicit starts win, the rest follow back-to-back. */
export function placeCues(cues: ImportedCue[], from: number, defaults: Partial<VoiceBlock>): VoiceBlock[] {
  let cursor = from;
  return cues.map((c) => {
    const start = c.start ?? cursor;
    const b = newBlock(start, defaults, c.text);
    cursor = start + blockDuration(b) + 0.3;
    return b;
  });
}

export function fmtTime(s: number, withTenths = true): string {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  return `${sign}${m}:${withTenths ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0')}`;
}

export function parseTimeInput(s: string): number | null {
  const v = parseClock(s);
  if (v !== null) return v;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
