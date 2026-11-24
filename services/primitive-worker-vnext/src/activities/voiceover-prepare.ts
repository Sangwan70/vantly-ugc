// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceover_prepare — runs once per uploaded recording:
 *
 *   proxy      720p H.264 with a keyframe every second, so scrubbing in the
 *              editor is instant even for 4K captures.
 *   filmstrip  one JPEG sprite of thumbnails for the timeline's video track.
 *   analysis   smart-edit suggestions from frame differencing:
 *                • focus  — small, stable regions of change (clicks, typing,
 *                           hover) → zoom keyframes + click markers
 *                • speed  — long stretches with nothing changing → 2× / cut
 *                • split  — whole-frame changes (page loads, scrolls) → cut points
 *
 * Writes the results onto voiceover_projects.source / .analysis. Never charged.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { storageRegions } from './voiceover-render.js';

const execFileP = promisify(execFile);

export interface VoiceoverPrepareActivityInput {
  project_id: string;
  user_id: string;
  source_url: string;
  storage_region?: string | null;
}

export interface EditSuggestion {
  id: string;
  kind: 'focus' | 'speed' | 'cut' | 'split' | 'click';
  /** Source-recording seconds. */
  start: number;
  end: number;
  x?: number;
  y?: number;
  zoom?: number;
  speed?: number;
  confidence: number;
  reason: string;
}

export interface Filmstrip {
  url: string;
  interval: number;
  cols: number;
  count: number;
  tile_w: number;
  tile_h: number;
}

// ── Frame-difference analysis (pure; unit-tested) ───────────────────────────

export interface FrameDiff {
  t: number;
  /** Fraction of pixels that changed. */
  changed: number;
  /** Centroid + bbox of changed pixels, 0..1 of the frame. */
  cx: number;
  cy: number;
  bw: number;
  bh: number;
}

export function diffFrames(prev: Uint8Array, cur: Uint8Array, w: number, h: number, t: number, threshold = 18, ignore?: Uint8Array): FrameDiff {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ignore?.[i]) continue;
      if (Math.abs(cur[i] - prev[i]) > threshold) {
        n++; sx += x; sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!n) return { t, changed: 0, cx: 0.5, cy: 0.5, bw: 0, bh: 0 };
  return { t, changed: n / (w * h), cx: sx / n / w, cy: sy / n / h, bw: (x1 - x0 + 1) / w, bh: (y1 - y0 + 1) / h };
}

const IDLE = 0.0015;
const GLOBAL = 0.3;

export function suggestEdits(diffs: FrameDiff[], duration: number, step: number): EditSuggestion[] {
  const out: EditSuggestion[] = [];
  let sid = 0;
  const id = () => `s${++sid}`;

  // Idle stretches → speed up (or cut when very long).
  let idleStart: number | null = null;
  const closeIdle = (end: number) => {
    if (idleStart === null) return;
    const len = end - idleStart;
    if (len >= 6) out.push({ id: id(), kind: 'cut', start: idleStart + 0.5, end: end - 0.5, confidence: Math.min(1, len / 12), reason: `${len.toFixed(1)}s with nothing happening` });
    else if (len >= 2.5) out.push({ id: id(), kind: 'speed', start: idleStart, end, speed: 2, confidence: Math.min(1, len / 6), reason: `${len.toFixed(1)}s of waiting` });
    idleStart = null;
  };
  for (const d of diffs) {
    if (d.changed < IDLE) { if (idleStart === null) idleStart = d.t - step; }
    else closeIdle(d.t - step);
  }
  closeIdle(duration);

  // Whole-frame changes → split points (debounced: one per 1.5s).
  let lastSplit = -10;
  for (const d of diffs) {
    if (d.changed >= GLOBAL && d.t - lastSplit > 1.5) {
      out.push({ id: id(), kind: 'split', start: d.t, end: d.t, confidence: Math.min(1, d.changed), reason: 'page change / scroll' });
      lastSplit = d.t;
    }
  }

  // Local activity clusters → focus zoom (+ click marker at the first sample).
  type Cl = { start: number; end: number; xs: number[]; ys: number[]; bw: number; bh: number };
  let cl: Cl | null = null;
  const flush = () => {
    if (!cl) return;
    const len = cl.end - cl.start;
    if (len >= 0.4) {
      const x = cl.xs.reduce((a, b) => a + b, 0) / cl.xs.length;
      const y = cl.ys.reduce((a, b) => a + b, 0) / cl.ys.length;
      const size = Math.max(cl.bw, cl.bh, 0.12);
      const zoom = Math.max(1.3, Math.min(2.2, 0.55 / size));
      out.push({ id: id(), kind: 'click', start: cl.start, end: cl.start + 0.6, x, y, confidence: 0.5, reason: 'activity starts here' });
      out.push({ id: id(), kind: 'focus', start: Math.max(0, cl.start - 0.4), end: Math.min(duration, cl.end + 1.2), x, y, zoom: Math.round(zoom * 10) / 10, confidence: Math.min(1, len / 2), reason: 'focused activity in one area' });
    }
    cl = null;
  };
  for (const d of diffs) {
    const local = d.changed >= IDLE && d.changed < GLOBAL && d.bw < 0.45 && d.bh < 0.45;
    if (!local) { if (cl && d.t - cl.end > 0.75) flush(); continue; }
    if (cl && (d.t - cl.end > 0.75 || Math.hypot(d.cx - cl.xs[0], d.cy - cl.ys[0]) > 0.15)) flush();
    if (!cl) cl = { start: d.t, end: d.t, xs: [], ys: [], bw: 0, bh: 0 };
    cl.end = d.t;
    cl.xs.push(d.cx);
    cl.ys.push(d.cy);
    cl.bw = Math.max(cl.bw, d.bw);
    cl.bh = Math.max(cl.bh, d.bh);
  }
  flush();

  // Focus windows overlapping a split are trimmed to end before it.
  return out.sort((a, b) => a.start - b.start);
}

// ── Activity ────────────────────────────────────────────────────────────────

async function streamGrayFrames(path: string, fps: number, w: number, h: number, onFrame: (buf: Uint8Array, idx: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-v', 'error', '-i', path, '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = w * h;
    let pending = Buffer.alloc(0);
    let idx = 0;
    let lastBeat = Date.now();
    proc.stdout.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= size) {
        onFrame(new Uint8Array(pending.subarray(0, size)), idx++);
        pending = pending.subarray(size);
      }
      if (Date.now() - lastBeat > 5000) { lastBeat = Date.now(); try { Context.current().heartbeat({ stage: 'analysis', idx }); } catch { /* tests */ } }
    });
    let err = '';
    proc.stderr.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-2000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg analysis exited ${code}: ${err}`))));
  });
}

export async function analyzeRecording(path: string, duration: number, srcW: number, srcH: number): Promise<EditSuggestion[]> {
  const fps = 4;
  const w = 96;
  const h = Math.max(8, Math.round((w * srcH) / srcW / 2) * 2);
  const frames: Uint8Array[] = [];
  await streamGrayFrames(path, fps, w, h, (buf) => { frames.push(buf); });
  if (frames.length < 2) return [];
  // Pixels that change in most frames are animation (tickers, clocks, live
  // badges, video players) — mask them so they don't drown out real activity.
  const freq = new Uint16Array(w * h);
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1];
    const b = frames[f];
    for (let i = 0; i < freq.length; i++) if (Math.abs(b[i] - a[i]) > 18) freq[i]++;
  }
  const ignore = new Uint8Array(w * h);
  const limit = (frames.length - 1) * 0.25;
  for (let i = 0; i < freq.length; i++) if (freq[i] > limit) ignore[i] = 1;
  const diffs: FrameDiff[] = [];
  for (let f = 1; f < frames.length; f++) diffs.push(diffFrames(frames[f - 1], frames[f], w, h, f / fps, 18, ignore));
  return suggestEdits(diffs, duration, 1 / fps);
}

export function makeVoiceoverPrepareActivity(cfg: WorkerConfig) {
  return async function voiceoverPrepare(input: VoiceoverPrepareActivityInput): Promise<{ proxy_url: string; filmstrip: Filmstrip; suggestions: number }> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const regions = storageRegions(cfg.r2);
    const store = regions[input.storage_region ?? 'default'] ?? regions.default;
    if (!Object.values(regions).some((r) => input.source_url.startsWith(r.publicUrl.replace(/\/+$/, '') + '/'))) {
      throw ApplicationFailure.nonRetryable('source must be hosted on our storage', 'REFERENCE_URL_NOT_ALLOWED');
    }
    const workDir = await mkdtemp(join(tmpdir(), `vnext-vo-prepare-${input.project_id}-`));
    const key = `studio-${input.project_id}`;
    try {
      const src = join(workDir, 'source');
      const resp = await fetch(input.source_url, { signal: AbortSignal.timeout(20 * 60_000) });
      if (!resp.ok || !resp.body) throw ApplicationFailure.nonRetryable(`source fetch failed (${resp.status})`, 'REFERENCE_FETCH_FAILED');
      await pipeline(Readable.fromWeb(resp.body as never), createWriteStream(src));
      const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', src]);
      const j = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number }>; format?: { duration?: string } };
      const vs = j.streams?.find((s) => s.codec_type === 'video');
      if (!vs?.width || !vs.height) throw ApplicationFailure.nonRetryable('not a video', 'REFERENCE_NOT_VIDEO');
      const duration = Number(j.format?.duration ?? 0);
      const hasAudio = Boolean(j.streams?.some((s) => s.codec_type === 'audio'));

      // Proxy
      const proxy = join(workDir, 'proxy.mp4');
      await execFileP('ffmpeg', [
        '-y', '-v', 'error', '-i', src,
        '-vf', `scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']),
        '-movflags', '+faststart', proxy,
      ], { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 });
      Context.current().heartbeat({ stage: 'proxy' });
      const { publicUrl: proxyUrl } = await r2UploadVnext(store, key, 'proxy.mp4', await readFile(proxy), 'video/mp4');

      // Filmstrip: ≤ 240 tiles, 10 per row.
      const interval = Math.max(1, Math.ceil(duration / 240));
      const count = Math.max(1, Math.ceil(duration / interval));
      const cols = 10;
      const rows = Math.ceil(count / cols);
      const tileW = 160;
      const tileH = Math.max(2, Math.round((tileW * vs.height) / vs.width / 2) * 2);
      const sprite = join(workDir, 'filmstrip.jpg');
      await execFileP('ffmpeg', ['-y', '-v', 'error', '-i', proxy, '-vf', `fps=1/${interval},scale=${tileW}:${tileH},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', sprite], { timeout: 15 * 60_000 });
      const { publicUrl: stripUrl } = await r2UploadVnext(store, key, 'filmstrip.jpg', await readFile(sprite), 'image/jpeg');
      const filmstrip: Filmstrip = { url: stripUrl, interval, cols, count, tile_w: tileW, tile_h: tileH };
      Context.current().heartbeat({ stage: 'filmstrip' });

      // Smart-edit analysis (on the proxy: same content, far fewer pixels to decode).
      const suggestions = await analyzeRecording(proxy, duration, vs.width, vs.height);

      const { data: row } = await db.from('voiceover_projects').select('source').eq('id', input.project_id).maybeSingle();
      const source = { ...((row?.source as Record<string, unknown>) ?? {}), proxy_url: proxyUrl, filmstrip, has_audio: hasAudio, width: vs.width, height: vs.height, duration };
      const { error } = await db
        .from('voiceover_projects')
        .update({ source, analysis: { version: 1, created_at: new Date().toISOString(), suggestions }, prepare_status: 'ready' })
        .eq('id', input.project_id);
      if (error) throw new Error(`voiceover_projects update failed: ${error.message}`);
      return { proxy_url: proxyUrl, filmstrip, suggestions: suggestions.length };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await db.from('voiceover_projects').update({ prepare_status: 'failed' }).eq('id', input.project_id);
      }
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
