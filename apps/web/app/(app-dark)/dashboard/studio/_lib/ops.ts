// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Pure timeline operations for the Voiceover Studio editor. Every edit goes
 * through one of these and returns a NEW timeline (undo/redo keeps snapshots).
 */

import {
  VoiceBlockSchema,
  TextOverlaySchema,
  clipOutputDuration,
  locateOutputTime,
  timelineDuration,
  type VoiceBlock,
  type VoiceoverClip,
  type VoiceoverTimeline,
  type TextOverlay,
} from '@vantly-ugc/schema';

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** ~150 words/min ≈ 14 characters/s of narration (same pace as the cue sheets). */
export const CHARS_PER_SECOND = 14;

export function blockDuration(b: VoiceBlock): number {
  if (b.audio_url && b.audio_duration) return b.audio_duration;
  return Math.max(0.8, b.text.trim().length / CHARS_PER_SECOND);
}

export function blockIsStale(b: VoiceBlock): boolean {
  return Boolean(b.audio_url) && b.generated_text !== null && b.generated_text !== b.text;
}

export function clipStarts(t: VoiceoverTimeline): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of t.clips) { out.push(acc); acc += clipOutputDuration(c); }
  return out;
}

export function splitAt(t: VoiceoverTimeline, outT: number): { timeline: VoiceoverTimeline; newId: string | null } {
  const loc = locateOutputTime(t, outT);
  if (!loc) return { timeline: t, newId: null };
  const c = t.clips[loc.index];
  if (loc.srcT - c.src_in < 0.1 || c.src_out - loc.srcT < 0.1) return { timeline: t, newId: null };
  const left: VoiceoverClip = { ...c, src_out: loc.srcT, fade_out: 0 };
  const right: VoiceoverClip = { ...c, id: uid('c'), src_in: loc.srcT, fade_in: 0 };
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
  const blocks = [...t.blocks].sort((a, b) => a.start - b.start);
  let end = 0;
  const out = blocks.map((b, i) => {
    const start = i === 0 ? b.start : Math.max(b.start, end + gap);
    end = start + blockDuration(b);
    return { ...b, start };
  });
  return { ...t, blocks: out };
}

/** Room until the next block (or the end of the video), like the cue sheet's "max". */
export function blockRoom(t: VoiceoverTimeline, b: VoiceBlock): number {
  const next = t.blocks.filter((x) => x.start > b.start + 1e-6).sort((a, z) => a.start - z.start)[0];
  const limit = next ? next.start : timelineDuration(t);
  return Math.max(0, limit - b.start);
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
  const m = /^(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)$/.exec(s.trim()) ?? /^(\d+):(\d+(?:[.,]\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const parts = s.trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Accepts three shapes:
 *   1. ElevenLabs cue sheet  — "CUE 3  |  start 0:28.5  |  max 9.4s" + text lines
 *   2. SRT                    — numbered blocks with "00:00:01,000 --> ..."
 *   3. Plain script           — paragraphs separated by blank lines
 */
export function parseScript(raw: string): ImportedCue[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  if (/^CUE\s+\d+\s*\|/im.test(text)) {
    const cues: ImportedCue[] = [];
    const re = /^CUE\s+\d+\s*\|\s*start\s+([\d:.,]+)[^\n]*\n([\s\S]*?)(?=^CUE\s+\d+\s*\||$(?![\s\S]))/gim;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const body = m[2].trim();
      if (body) cues.push({ start: parseClock(m[1]), text: body.replace(/\s*\n\s*/g, ' ') });
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
        const start = parseClock(lines[ti].split('-->')[0].trim());
        return { start, text: lines.slice(ti + 1).join(' ') };
      })
      .filter((c): c is ImportedCue => Boolean(c && c.text));
  }

  return text
    .split(/\n\s*\n/)
    .map((p) => ({ start: null, text: p.replace(/\s*\n\s*/g, ' ').trim() }))
    .filter((c) => c.text);
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
