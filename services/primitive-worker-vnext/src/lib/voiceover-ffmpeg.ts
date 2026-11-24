// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio render plan → ffmpeg arguments. Pure functions only (no
 * I/O) so the whole plan is unit-testable.
 *
 *   1. segments — one per clip, composed onto the FULL output frame: seek,
 *      speed, camera (zoom/pan or keyframes), blur-fill / bars / crop, fades.
 *      Title cards are generated here too. Memory stays flat with any number
 *      of cuts and each segment is a progress/heartbeat point.
 *   2. join    — concat demuxer (stream copy) when there are no transitions,
 *      otherwise concat runs + xfade between them.
 *   3. final   — redaction (pixelate), text/effects (ASS), captions (ASS),
 *      logo, voice mix with per-block trims + click-free fades, music with
 *      sidechain ducking, loudness normalisation, provenance metadata.
 */

import {
  captionLines,
  clipOutputDuration,
  clipStarts,
  resolveCaptionStyle,
  transitionOverlap,
  type CameraKeyframe,
  type TextOverlay,
  type VoiceoverAspect,
  type VoiceoverAudio,
  type VoiceoverBranding,
  type VoiceoverCaptionStyle,
  type VoiceoverCard,
  type VoiceoverClip,
  type VoiceoverEasing,
  type VoiceoverEffect,
  type VoiceoverOutput,
  type VoiceoverWord,
} from '@vantly-ugc/schema';

export const RENDER_FPS = 30;

export type Quality = VoiceoverOutput['quality'];

export interface Canvas {
  /** Output frame. */
  W: number;
  H: number;
  /** The recording's box inside the frame. */
  cw: number;
  ch: number;
  /** Fill the canvas by cropping instead of letter/pillar-boxing. */
  cover: boolean;
  fit: VoiceoverOutput['fit'];
  /**
   * Where the recording's full frame lands on the canvas, in canvas pixels:
   * the centred box for blur/black, the scaled-up (edge-cropped) frame for
   * cover. Effects, overlays and redactions are authored in recording-frame
   * coordinates (0..1), so they are mapped through this rect; captions, the
   * logo and the disclosure badge stay anchored to the canvas. Omitted = the
   * whole canvas.
   */
  content?: Rect;
}

export interface Rect { x: number; y: number; w: number; h: number }

const contentRect = (c: { W: number; H: number; content?: Rect }): Rect => c.content ?? { x: 0, y: 0, w: c.W, h: c.H };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const num = (n: number) => Number(n.toFixed(4)).toString();

/** Long side of the output frame for a quality tier. */
export function longSide(quality: Quality, source: { width: number; height: number }): number {
  if (quality === 'draft') return 1280;
  if (quality === 'high') return Math.min(3840, Math.max(1920, Math.max(source.width, source.height)));
  return 1920;
}

export function computeCanvas(
  source: { width: number; height: number },
  output: { aspect: VoiceoverAspect; fit: VoiceoverOutput['fit']; quality?: Quality },
): Canvas {
  const { width: sw, height: sh } = source;
  const L = longSide(output.quality ?? 'standard', source);
  let W: number;
  let H: number;
  switch (output.aspect) {
    case '16:9': W = L; H = even((L * 9) / 16); break;
    case '9:16': W = even((L * 9) / 16); H = L; break;
    case '1:1': W = H = even((L * 9) / 16); break;
    default: {
      const k = Math.min(1, L / Math.max(sw, sh));
      W = even(sw * k);
      H = even(sh * k);
    }
  }
  if (output.aspect === 'source') {
    return { W, H, cw: W, ch: H, cover: false, fit: output.fit, content: { x: 0, y: 0, w: W, h: H } };
  }
  if (output.fit === 'cover') {
    const s = Math.max(W / sw, H / sh);
    const w = sw * s;
    const h = sh * s;
    return { W, H, cw: W, ch: H, cover: true, fit: output.fit, content: { x: (W - w) / 2, y: (H - h) / 2, w, h } };
  }
  const k = Math.min(W / sw, H / sh);
  const cw = Math.min(W, even(sw * k));
  const ch = Math.min(H, even(sh * k));
  return { W, H, cw, ch, cover: false, fit: output.fit, content: { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch } };
}

export function encoderArgs(quality: Quality, intermediate = false): string[] {
  if (intermediate) return ['-c:v', 'libx264', '-preset', quality === 'draft' ? 'ultrafast' : 'veryfast', '-crf', quality === 'draft' ? '22' : '16'];
  if (quality === 'draft') return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26'];
  if (quality === 'high') return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
}

/** atempo only accepts 0.5–2.0 per instance; chain for anything outside. */
export function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${num(s)}`);
  return parts;
}

// ── Camera ──────────────────────────────────────────────────────────────────

function easeExpr(e: VoiceoverEasing, p: string): string {
  switch (e) {
    case 'linear': return `(${p})`;
    case 'ease_in': return `(${p})*(${p})`;
    case 'ease_out': return `(1-(1-(${p}))*(1-(${p})))`;
    case 'hold': return '0';
    default: return `(${p})*(${p})*(3-2*(${p}))`;
  }
}

/** Piecewise expression of one camera channel over T (seconds into the clip). Mirrors cameraAt(). */
export function keyframeExpr(kf: CameraKeyframe[], channel: 'zoom' | 'x' | 'y', T = 'T'): string {
  const k = [...kf].sort((a, b) => a.t - b.t);
  if (k.length === 1) return num(k[0][channel]);
  let expr = num(k[k.length - 1][channel]);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i];
    const b = k[i + 1];
    const span = Math.max(1e-3, b.t - a.t);
    const p = `min(max((${T}-${num(a.t)})/${num(span)},0),1)`;
    const seg = `${num(a[channel])}+(${num(b[channel] - a[channel])})*${easeExpr(a.ease, p)}`;
    expr = `if(lt(${T},${num(b.t)}),${seg},${expr})`;
  }
  return `if(lt(${T},${num(k[0].t)}),${num(k[0][channel])},${expr})`;
}

/**
 * zoompan for a clip, or null when the camera never moves. `on` is the output
 * frame number; with d=1 zoompan emits one frame per input frame, so T = on/fps.
 */
export function zoomFilter(clip: VoiceoverClip, cw: number, ch: number): string | null {
  const T = `on/${RENDER_FPS}`;
  let z: string;
  let x: string;
  let y: string;
  if (clip.keyframes?.length) {
    if (clip.keyframes.every((k) => k.zoom <= 1.001)) return null;
    z = keyframeExpr(clip.keyframes, 'zoom', T);
    x = keyframeExpr(clip.keyframes, 'x', T);
    y = keyframeExpr(clip.keyframes, 'y', T);
  } else {
    const zm = clip.zoom;
    if (!zm || zm.mode === 'none' || zm.scale <= 1.001) return null;
    const d = clipOutputDuration(clip);
    const S = num(zm.scale);
    const smooth = (p: string) => `(${p})*(${p})*(3-2*(${p}))`;
    if (zm.mode === 'in') z = `1+(${S}-1)*${smooth(`min(${T}/${num(d)},1)`)}`;
    else if (zm.mode === 'out') z = `${S}-(${S}-1)*${smooth(`min(${T}/${num(d)},1)`)}`;
    else {
      const e = Math.min(zm.ease, d / 2);
      z = e <= 0 ? S : `1+(${S}-1)*${smooth(`max(min(min(${T}/${num(e)},(${num(d)}-${T})/${num(e)}),1),0)`)}`;
    }
    x = num(zm.x);
    y = num(zm.y);
  }
  const zx = `max(0,min(iw-iw/zoom,(${x})*iw-iw/zoom/2))`;
  const zy = `max(0,min(ih-ih/zoom,(${y})*ih-ih/zoom/2))`;
  return `zoompan=z='${z}':x='${zx}':y='${zy}':d=1:s=${cw}x${ch}:fps=${RENDER_FPS}`;
}

// ── Segments ────────────────────────────────────────────────────────────────

/** Filter chain that places the recording box [in] onto the full canvas → [out]. */
function canvasChain(canvas: Canvas, input: string, out: string): string[] {
  const { W, H, cw, ch } = canvas;
  if (cw === W && ch === H) return [`${input}null${out}`];
  if (canvas.fit === 'black') return [`${input}pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black${out}`];
  return [
    `${input}split[cfg][cbgsrc]`,
    `[cbgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.08[cbg]`,
    `[cbg][cfg]overlay=(W-w)/2:(H-h)/2${out}`,
  ];
}

export interface SegmentPlan {
  srcPath: string;
  outPath: string;
  clip: VoiceoverClip;
  canvas: Canvas;
  quality: Quality;
  /** Keep the recording's own audio (segments then all carry an audio track). */
  withAudio: boolean;
}

export function buildSegmentArgs(p: SegmentPlan): string[] {
  const { clip, canvas } = p;
  const d = clipOutputDuration(clip);
  const chain: string[] = [`setpts=(PTS-STARTPTS)/${num(clip.speed)}`, `fps=${RENDER_FPS}`];
  const zoom = zoomFilter(clip, canvas.cw, canvas.ch);
  // Pre-scale 2× before zoompan so slow pans don't step a whole pixel at a time.
  const up = zoom && p.quality !== 'draft' ? 2 : 1;
  if (canvas.cover) {
    chain.push(`scale=${canvas.cw * up}:${canvas.ch * up}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${canvas.cw * up}:${canvas.ch * up}`);
  } else {
    chain.push(`scale=${canvas.cw * up}:${canvas.ch * up}:flags=lanczos`);
  }
  chain.push('setsar=1');
  if (zoom) chain.push(zoom);
  const graph = [`[0:v]${chain.join(',')}[box]`, ...canvasChain(canvas, '[box]', '[can]')];
  const post: string[] = [];
  if (clip.fade_in > 0) post.push(`fade=t=in:st=0:d=${num(Math.min(clip.fade_in, d / 2))}`);
  if (clip.fade_out > 0) {
    const f = Math.min(clip.fade_out, d / 2);
    post.push(`fade=t=out:st=${num(Math.max(0, d - f))}:d=${num(f)}`);
  }
  post.push('format=yuv420p');
  graph.push(`[can]${post.join(',')}[v]`);

  const args = ['-y', '-hide_banner', '-nostdin', '-ss', num(clip.src_in), '-to', num(clip.src_out), '-i', p.srcPath];
  if (p.withAudio) {
    const af = ['asetpts=PTS-STARTPTS', ...atempoChain(clip.speed), 'aresample=48000', 'aformat=channel_layouts=stereo'];
    if (clip.fade_in > 0) af.push(`afade=t=in:st=0:d=${num(Math.min(clip.fade_in, d / 2))}`);
    if (clip.fade_out > 0) {
      const f = Math.min(clip.fade_out, d / 2);
      af.push(`afade=t=out:st=${num(Math.max(0, d - f))}:d=${num(f)}`);
    }
    graph.push(`[0:a]${af.join(',')}[a]`);
  }
  args.push('-filter_complex', graph.join(';'), '-map', '[v]');
  if (p.withAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  args.push('-t', num(d), ...encoderArgs(p.quality, true), '-pix_fmt', 'yuv420p', '-r', String(RENDER_FPS), '-video_track_timescale', '15360', p.outPath);
  return args;
}

/** A title card segment: solid background + animated title/subtitle (+ logo). */
export function buildCardSegmentArgs(p: {
  card: VoiceoverCard;
  canvas: Canvas;
  quality: Quality;
  assPath: string;
  fontsDir?: string;
  logoPath?: string | null;
  withAudio: boolean;
  outPath: string;
}): string[] {
  const { canvas, card } = p;
  const useLogo = Boolean(p.logoPath && card.logo);
  const args = ['-y', '-hide_banner', '-nostdin', '-f', 'lavfi', '-i', `color=c=0x${card.bg.slice(1)}:s=${canvas.W}x${canvas.H}:r=${RENDER_FPS}:d=${num(card.duration)}`];
  if (useLogo) args.push('-i', p.logoPath!);
  if (p.withAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  const graph: string[] = [`[0:v]ass=filename=${escapeFilterPath(p.assPath)}${p.fontsDir ? `:fontsdir=${escapeFilterPath(p.fontsDir)}` : ''}[t]`];
  let v = '[t]';
  if (useLogo) {
    const lw = even(canvas.W * 0.14);
    graph.push(`[1:v]scale=${lw}:-2,format=rgba[lg]`, `[t][lg]overlay=(W-w)/2:H*0.16[c]`);
    v = '[c]';
  }
  graph.push(`${v}fade=t=in:st=0:d=0.3,fade=t=out:st=${num(Math.max(0, card.duration - 0.3))}:d=0.3,format=yuv420p[v]`);
  args.push('-filter_complex', graph.join(';'), '-map', '[v]');
  if (p.withAudio) args.push('-map', `${useLogo ? 2 : 1}:a`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  args.push('-t', num(card.duration), ...encoderArgs(p.quality, true), '-pix_fmt', 'yuv420p', '-r', String(RENDER_FPS), '-video_track_timescale', '15360', p.outPath);
  return args;
}

/**
 * Greedy word wrap against an estimated text width. Liberation Sans measured
 * ~0.43em per char bold and ~0.38em regular on rendered cards (mixed-case
 * titles incl. spaces); 0.46 / 0.42 leaves a margin so libass never has to
 * re-wrap on its own.
 */
export function wrapForWidth(text: string, fontPx: number, maxWidth: number, bold: boolean): string[] {
  const per = fontPx * (bold ? 0.46 : 0.42);
  const maxChars = Math.max(1, Math.floor(maxWidth / per));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para.length <= maxChars) { out.push(para); continue; } // fits: keep it verbatim
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > maxChars) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function buildCardAss(card: VoiceoverCard, W: number, H: number, fontFamily = 'Liberation Sans'): string {
  const k = H / 1080;
  const ts = Math.round(84 * k * (W < H ? 0.8 : 1));
  const ss = Math.round(40 * k * (W < H ? 0.85 : 1));
  const cx = Math.round(W / 2);
  const ty = Math.round(H * 0.5);
  // Wrap explicitly and lay out from the real line counts. libass centres a
  // multi-line \an5 block on its anchor, so a title that wrapped on its own
  // (any long title in 9:16) grew down into the subtitle.
  const maxW = W - 80;
  const titleLines = card.title ? wrapForWidth(card.title, ts, maxW, true) : [];
  const subLines = card.subtitle ? wrapForWidth(card.subtitle, ss, maxW, false) : [];
  const titleHalf = (Math.max(1, titleLines.length) - 1) * ts * 1.1 / 2;
  // One-line title + one-line subtitle reproduces the original 16:9 layout exactly.
  const sy = Math.round(ty + titleHalf + ts * 0.95 + (Math.max(1, subLines.length) - 1) * ss * 1.2 / 2);
  const barW = Math.round(W * 0.12);
  const barY = Math.round(ty - titleHalf - ts * 0.85);
  const anim = (x: number, y: number, t0: number) => {
    if (card.animation === 'pop') return `\\pos(${x},${y})\\fscx40\\fscy40\\alpha&HFF&\\t(${t0},${t0 + 1},\\alpha&H00&)\\t(${t0},${t0 + 220},\\fscx108\\fscy108)\\t(${t0 + 220},${t0 + 340},\\fscx100\\fscy100)`;
    if (card.animation === 'fade') return `\\pos(${x},${y})\\alpha&HFF&\\t(${t0},${t0 + 400},\\alpha&H00&)`;
    const dy = Math.round(40 * k);
    return `\\move(${x},${y + dy},${x},${y},${t0},${t0 + 450})\\alpha&HFF&\\t(${t0},${t0 + 350},\\alpha&H00&)`;
  };
  const end = assTime(card.duration);
  const bar = `m 0 0 l ${barW} 0 l ${barW} ${Math.max(2, Math.round(8 * k))} l 0 ${Math.max(2, Math.round(8 * k))}`;
  const lines = [`Dialogue: 0,0:00:00.00,${end},Card,,0,0,0,,{\\an5\\p1\\bord0\\shad0\\1c${assColor(card.accent)}&${anim(cx, barY, 0)}}${bar}{\\p0}`];
  if (card.title) lines.push(`Dialogue: 1,0:00:00.00,${end},Card,,0,0,0,,{\\an5\\fs${ts}\\b1\\1c${assColor(card.color)}&${anim(cx, ty, 120)}}${assText(titleLines.join('\n'))}`);
  if (card.subtitle) lines.push(`Dialogue: 1,0:00:00.00,${end},Card,,0,0,0,,{\\an5\\fs${ss}\\b0\\1c${assColor(card.color)}&${anim(cx, sy, 300)}}${assText(subLines.join('\n'))}`);
  return assHeader(W, H, [`Style: Card,${fontFamily},${ts},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1`]) + lines.join('\n') + '\n';
}

// ── Join ────────────────────────────────────────────────────────────────────

export function concatListFile(segmentPaths: string[]): string {
  return segmentPaths.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

export const XFADE_NAMES: Record<string, string> = {
  crossfade: 'fade',
  fade_black: 'fadeblack',
  slide_left: 'slideleft',
  slide_up: 'slideup',
  zoom: 'zoomin',
  wipe: 'wipeleft',
};

/**
 * Decode a narration/music file to 48 kHz stereo PCM before the final mix.
 * ElevenLabs returns mono MP3s whose frame parameters can shift mid-stream;
 * ffmpeg 5.x then reinitialises the whole filter graph and fails layout
 * negotiation ("Cannot select channel layout … alimiter"). Uniform WAV inputs
 * never trigger a reinit.
 */
export function buildAudioNormalizeArgs(inPath: string, outPath: string): string[] {
  return ['-y', '-hide_banner', '-nostdin', '-i', inPath, '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outPath];
}

/** True when any clip transitions from the previous one. */
export function hasTransitions(clips: VoiceoverClip[]): boolean {
  return clips.some((_, i) => transitionOverlap({ clips }, i) > 0);
}

/**
 * Join segments with xfade between "runs" of clips that have no transition.
 * `xfadeName` lets the caller substitute transitions its ffmpeg lacks.
 */
export function buildJoinArgs(p: {
  segmentPaths: string[];
  clips: VoiceoverClip[];
  withAudio: boolean;
  quality: Quality;
  outPath: string;
  xfadeName?: (kind: string) => string;
}): string[] {
  const { clips } = p;
  const starts = clipStarts({ clips });
  const runs: number[][] = [];
  clips.forEach((_, i) => {
    if (i === 0 || transitionOverlap({ clips }, i) > 0) runs.push([i]);
    else runs[runs.length - 1].push(i);
  });
  const graph: string[] = [];
  runs.forEach((run, r) => {
    if (run.length === 1) {
      graph.push(`[${run[0]}:v]fps=${RENDER_FPS},settb=AVTB,setpts=PTS-STARTPTS[rv${r}]`);
      if (p.withAudio) graph.push(`[${run[0]}:a]anull[ra${r}]`);
    } else {
      const ins = run.map((i) => (p.withAudio ? `[${i}:v][${i}:a]` : `[${i}:v]`)).join('');
      graph.push(`${ins}concat=n=${run.length}:v=1:a=${p.withAudio ? 1 : 0}[rc${r}]${p.withAudio ? `[ra${r}]` : ''}`);
      // xfade needs identical timebases/frame rates on both inputs; concat changes them.
      graph.push(`[rc${r}]fps=${RENDER_FPS},settb=AVTB,setpts=PTS-STARTPTS[rv${r}]`);
    }
  });
  let v = '[rv0]';
  let a = '[ra0]';
  for (let r = 1; r < runs.length; r++) {
    const i = runs[r][0];
    const d = transitionOverlap({ clips }, i);
    const name = (p.xfadeName ?? ((k: string) => XFADE_NAMES[k] ?? 'fade'))(clips[i].transition.kind);
    graph.push(`${v}[rv${r}]xfade=transition=${name}:duration=${num(d)}:offset=${num(starts[i])}[xv${r}]`);
    v = `[xv${r}]`;
    if (p.withAudio) {
      graph.push(`${a}[ra${r}]acrossfade=d=${num(d)}[xa${r}]`);
      a = `[xa${r}]`;
    }
  }
  const args = ['-y', '-hide_banner', '-nostdin'];
  for (const s of p.segmentPaths) args.push('-i', s);
  args.push('-filter_complex', graph.join(';'), '-map', v);
  if (p.withAudio) args.push('-map', a, '-c:a', 'aac', '-b:a', '192k');
  args.push(...encoderArgs(p.quality, true), '-pix_fmt', 'yuv420p', '-r', String(RENDER_FPS), p.outPath);
  return args;
}

// ── Final pass ──────────────────────────────────────────────────────────────

export interface VoiceInput {
  path: string;
  /** Output-timeline start (seconds). */
  start: number;
  volume: number;
  /** Trim inside the take (seconds). */
  audioIn?: number;
  audioOut?: number | null;
}

export interface FinalPlan {
  /** Joined video (file) or concat list (demuxer). */
  video: { kind: 'file' | 'concat'; path: string };
  voices: VoiceInput[];
  canvas: Canvas;
  quality: Quality;
  redactions?: VoiceoverEffect[];
  overlayAssPath?: string;
  captionsAssPath?: string;
  fontsDir?: string;
  logo?: { path: string; branding: VoiceoverBranding } | null;
  music?: { path: string; settings: NonNullable<VoiceoverAudio['music']> } | null;
  audio?: Pick<VoiceoverAudio, 'loudness' | 'voice_fades'>;
  /** Segments carry the recording's audio; mix it at this volume. 0 / undefined = none. */
  originalVolume?: number;
  metadata?: Record<string, string>;
  total: number;
  outPath: string;
}

const LUFS = { youtube: -14, podcast: -16, broadcast: -23 } as const;

export function buildFinalArgs(p: FinalPlan): string[] {
  const { canvas } = p;
  const { W, H } = canvas;
  const graph: string[] = [];
  const args = ['-y', '-hide_banner', '-nostdin'];
  if (p.video.kind === 'concat') args.push('-f', 'concat', '-safe', '0');
  args.push('-i', p.video.path);
  let idx = 1;
  const voiceIdx: number[] = [];
  for (const voice of p.voices) { args.push('-i', voice.path); voiceIdx.push(idx++); }
  let musicIdx = -1;
  if (p.music) {
    if (p.music.settings.loop) args.push('-stream_loop', '-1');
    args.push('-i', p.music.path);
    musicIdx = idx++;
  }
  let logoIdx = -1;
  if (p.logo) { args.push('-i', p.logo.path); logoIdx = idx++; }

  // Video
  let v = '[0:v]';
  const R = contentRect(canvas);
  (p.redactions ?? []).forEach((e, i) => {
    const bw = Math.min(even(W), even(e.w * R.w));
    const bh = Math.min(even(H), even(e.h * R.h));
    const bx = Math.max(0, Math.min(W - bw, Math.round(R.x + e.x * R.w - bw / 2)));
    const by = Math.max(0, Math.min(H - bh, Math.round(R.y + e.y * R.h - bh / 2)));
    // Pixelate (not blur): blurred text can sometimes be recovered.
    const block = Math.max(6, Math.round(8 + e.intensity * 28));
    graph.push(
      `${v}split[rd${i}a][rd${i}b]`,
      `[rd${i}b]crop=${bw}:${bh}:${bx}:${by},scale=${Math.max(2, Math.round(bw / block))}:${Math.max(2, Math.round(bh / block))},scale=${bw}:${bh}:flags=neighbor[rd${i}p]`,
      `[rd${i}a][rd${i}p]overlay=${bx}:${by}:enable='between(t,${num(e.start)},${num(e.end)})'[rd${i}]`,
    );
    v = `[rd${i}]`;
  });
  const fontsOpt = p.fontsDir ? `:fontsdir=${escapeFilterPath(p.fontsDir)}` : '';
  if (p.overlayAssPath) { graph.push(`${v}ass=filename=${escapeFilterPath(p.overlayAssPath)}${fontsOpt}[vtxt]`); v = '[vtxt]'; }
  if (p.captionsAssPath) { graph.push(`${v}ass=filename=${escapeFilterPath(p.captionsAssPath)}${fontsOpt}[vcap]`); v = '[vcap]'; }
  if (p.logo) {
    const b = p.logo.branding;
    const lw = even(W * b.logo_size);
    const m = Math.round(Math.min(W, H) * 0.03);
    const x = b.logo_position.endsWith('l') ? `${m}` : `W-w-${m}`;
    const y = b.logo_position.startsWith('t') ? `${m}` : `H-h-${m}`;
    graph.push(`[${logoIdx}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=${num(b.logo_opacity)}[lg]`, `${v}[lg]overlay=${x}:${y}:format=auto[vlogo]`);
    v = '[vlogo]';
  }
  graph.push(`${v}format=yuv420p[vout]`);

  // Audio
  const fades = p.audio?.voice_fades ?? true;
  const voiceLabels: string[] = [];
  p.voices.forEach((voice, i) => {
    const ms = Math.max(0, Math.round(voice.start * 1000));
    const chain: string[] = [];
    const a0 = voice.audioIn ?? 0;
    const a1 = voice.audioOut ?? null;
    if (a0 > 0 || a1 !== null) chain.push(`atrim=start=${num(a0)}${a1 !== null ? `:end=${num(a1)}` : ''}`, 'asetpts=PTS-STARTPTS');
    chain.push('aresample=48000', 'aformat=channel_layouts=stereo');
    if (fades) {
      chain.push('afade=t=in:st=0:d=0.015');
      if (a1 !== null) chain.push(`afade=t=out:st=${num(Math.max(0, a1 - a0 - 0.04))}:d=0.04`);
    }
    chain.push(`volume=${num(voice.volume)}`, `adelay=${ms}|${ms}`);
    graph.push(`[${voiceIdx[i]}:a]${chain.join(',')}[vo${i}]`);
    voiceLabels.push(`[vo${i}]`);
  });
  const bus: string[] = [];
  let voiceBus: string | null = null;
  if (voiceLabels.length === 1) voiceBus = voiceLabels[0];
  else if (voiceLabels.length > 1) {
    graph.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[vbus]`);
    voiceBus = '[vbus]';
  }

  if (p.music) {
    const m = p.music.settings;
    const mchain = [`atrim=0:${num(p.total)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=channel_layouts=stereo', `volume=${num(m.volume)}`];
    if (m.fade_in > 0) mchain.push(`afade=t=in:st=0:d=${num(m.fade_in)}`);
    if (m.fade_out > 0) mchain.push(`afade=t=out:st=${num(Math.max(0, p.total - m.fade_out))}:d=${num(m.fade_out)}`);
    graph.push(`[${musicIdx}:a]${mchain.join(',')}[mus]`);
    if (voiceBus && m.duck && m.duck_amount > 0) {
      graph.push(`${voiceBus}asplit=2[vmain][vsc]`);
      graph.push(`[mus][vsc]sidechaincompress=threshold=0.012:ratio=${num(1 + 19 * m.duck_amount)}:attack=15:release=450:makeup=1[mduck]`);
      bus.push('[vmain]', '[mduck]');
    } else {
      if (voiceBus) bus.push(voiceBus);
      bus.push('[mus]');
    }
  } else if (voiceBus) {
    bus.push(voiceBus);
  }
  if (p.originalVolume && p.originalVolume > 0) {
    graph.push(`[0:a]volume=${num(p.originalVolume)}[orig]`);
    bus.push('[orig]');
  }
  const loud = p.audio?.loudness ?? 'youtube';
  const master: string[] = [];
  if (loud !== 'off') master.push(`loudnorm=I=${LUFS[loud]}:TP=-1.5:LRA=11`, 'aresample=48000');
  // Pin the format before the limiter so negotiation never depends on what
  // loudnorm/amix leave unspecified.
  master.push('aformat=sample_rates=48000:channel_layouts=stereo', 'alimiter=limit=0.95', 'apad');
  if (bus.length === 0) graph.push('anullsrc=r=48000:cl=stereo[aout]');
  else if (bus.length === 1) graph.push(`${bus[0]}${master.join(',')}[aout]`);
  else graph.push(`${bus.join('')}amix=inputs=${bus.length}:normalize=0:dropout_transition=0,${master.join(',')}[aout]`);

  args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', num(p.total));
  args.push(...encoderArgs(p.quality), '-pix_fmt', 'yuv420p', '-r', String(RENDER_FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  for (const [k, val] of Object.entries(p.metadata ?? {})) args.push('-metadata', `${k}=${val}`);
  args.push('-movflags', '+faststart', p.outPath);
  return args;
}

/** Paths inside a filtergraph: escape the characters the parser treats specially. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

// ── ASS helpers ─────────────────────────────────────────────────────────────

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** #RRGGBB → ASS &HAABBGGRR (AA=00 opaque). */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '');
  return `&H${alpha.toString(16).padStart(2, '0')}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

const assAlpha = (opacity: number) =>
  `&H${Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;

function assText(s: string): string {
  return s.replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

function assHeader(W: number, H: number, styles: string[]): string {
  return `[Script Info]
Title: Voiceover Studio
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/** Resolve a font reference (built-in family or custom asset id) to a family name. */
export type FontResolver = (ref: string) => string;
export const builtinFonts: FontResolver = (ref) => ref || 'Liberation Sans';

/** Closed circle path (4 cubic béziers) centred at 0,0. */
function circlePath(r: number): string {
  const c = Math.round(r * 0.5523);
  return `m 0 ${-r} b ${c} ${-r} ${r} ${-c} ${r} 0 b ${r} ${c} ${c} ${r} 0 ${r} b ${-c} ${r} ${-r} ${c} ${-r} 0 b ${-r} ${-c} ${-c} ${-r} 0 ${-r}`;
}

/** Arrow polygon from (x0,y0) to (x1,y1), in absolute pixels. */
export function arrowPath(x0: number, y0: number, x1: number, y1: number, width: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const head = Math.min(len * 0.45, width * 3.2);
  const hw = width * 1.6;
  const sw = width / 2;
  const bx = x1 - ux * head;
  const by = y1 - uy * head;
  const pts = [
    [x0 + nx * sw, y0 + ny * sw], [bx + nx * sw, by + ny * sw], [bx + nx * hw, by + ny * hw], [x1, y1],
    [bx - nx * hw, by - ny * hw], [bx - nx * sw, by - ny * sw], [x0 - nx * sw, y0 - ny * sw],
  ].map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`);
  return `m ${pts[0]} l ${pts.slice(1).join(' l ')}`;
}

function effectEvents(effects: VoiceoverEffect[], W: number, H: number, R: Rect = { x: 0, y: 0, w: W, h: H }): string[] {
  const k = R.h / 1080;
  const out: string[] = [];
  for (const e of effects) {
    if (e.kind === 'blur') continue; // pixelated in the filtergraph
    const s = assTime(e.start);
    const en = assTime(e.end);
    const dur = Math.round((e.end - e.start) * 1000);
    const fade = Math.min(200, Math.floor(dur / 3));
    const x = Math.round(R.x + e.x * R.w);
    const y = Math.round(R.y + e.y * R.h);
    const bw = Math.round(e.w * R.w);
    const bh = Math.round(e.h * R.h);
    if (e.kind === 'click') {
      const r = Math.round((26 + 40 * e.intensity) * k);
      const ring = Math.max(2, Math.round(5 * k));
      const rippleEnd = assTime(Math.min(e.end, e.start + 0.7));
      out.push(`Dialogue: 2,${s},${rippleEnd},FX,,0,0,0,,{\\an7\\pos(${x},${y})\\p1\\1a&HFF&\\bord${ring}\\3c${assColor(e.color)}&\\shad0\\fscx35\\fscy35\\t(0,600,\\fscx160\\fscy160\\3a&HFF&)}${circlePath(r)}{\\p0}`);
      out.push(`Dialogue: 2,${s},${en},FX,,0,0,0,,{\\an7\\pos(${x},${y})\\p1\\1c${assColor(e.color)}&\\1a&H40&\\bord${Math.max(1, Math.round(2 * k))}\\3c&H000000&\\shad0\\fad(80,${fade})}${circlePath(Math.round(9 * k))}{\\p0}`);
    } else if (e.kind === 'spotlight') {
      const x0 = Math.round(Math.max(0, x - bw / 2));
      const y0 = Math.round(Math.max(0, y - bh / 2));
      const x1 = Math.round(Math.min(W, x + bw / 2));
      const y1 = Math.round(Math.min(H, y + bh / 2));
      // Outer rect clockwise, inner rect counter-clockwise → the inner rect is a hole.
      const path = `m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H} m ${x0} ${y0} l ${x0} ${y1} l ${x1} ${y1} l ${x1} ${y0}`;
      out.push(`Dialogue: 0,${s},${en},FX,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H000000&\\1a${assAlpha(0.25 + 0.6 * e.intensity)}\\fad(${fade},${fade})}${path}{\\p0}`);
    } else if (e.kind === 'highlight') {
      const path = `m 0 0 l ${bw} 0 l ${bw} ${bh} l 0 ${bh}`;
      out.push(`Dialogue: 1,${s},${en},FX,,0,0,0,,{\\an7\\pos(${Math.round(x - bw / 2)},${Math.round(y - bh / 2)})\\p1\\1c${assColor(e.color)}&\\1a${assAlpha(0.18 * e.intensity)}\\bord${Math.max(2, Math.round(5 * k))}\\3c${assColor(e.color)}&\\shad0\\fad(${fade},${fade})}${path}{\\p0}`);
    } else if (e.kind === 'arrow') {
      const path = arrowPath(R.x + e.from_x * R.w, R.y + e.from_y * R.h, x, y, Math.max(6, Math.round(12 * k)));
      out.push(`Dialogue: 2,${s},${en},FX,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c${assColor(e.color)}&\\bord${Math.max(1, Math.round(3 * k))}\\3c&H000000&\\shad0\\fad(${fade},${fade})}${path}{\\p0}`);
    }
  }
  return out;
}

/** Text overlays + lower thirds + callouts + effects + disclosure badge, in one ASS. */
export function buildOverlayAss(
  overlays: TextOverlay[],
  W: number,
  H: number,
  opts?: { effects?: VoiceoverEffect[]; fonts?: FontResolver; disclosure?: { position: 'tl' | 'tr' | 'bl' | 'br'; total: number } | null; content?: Rect },
): string {
  // Overlays are authored on the recording frame; scale and place them in its box.
  const R = contentRect({ W, H, content: opts?.content });
  const k = R.h / 1080;
  const font = opts?.fonts ?? builtinFonts;
  const lines: string[] = effectEvents(opts?.effects ?? [], W, H, R);
  overlays
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((o, i) => {
      const layer = 10 + i * 2;
      const x = Math.round(R.x + o.x * R.w);
      const y = Math.round(R.y + o.y * R.h);
      const fs = Math.round(o.size * k);
      const durMs = Math.round((o.end - o.start) * 1000);
      const fadeMs = Math.min(250, Math.floor(durMs / 3));
      const s = assTime(o.start);
      const e = assTime(o.end);
      const fam = font(o.font);
      if (o.kind === 'lower_third') {
        const subFs = Math.round(fs * 0.55);
        const estW = Math.round(Math.max(o.text.length * fs * 0.56, o.subtitle.length * subFs * 0.52) + 48 * k);
        const barH = Math.round(fs * 1.25 + (o.subtitle ? subFs * 1.35 : 0) + 16 * k);
        const top = y - Math.round(barH / 2);
        const slide = Math.round(60 * k);
        const mv = (yy: number, xx: number) => `\\move(${xx - slide},${yy},${xx},${yy},0,${Math.min(450, durMs)})`;
        const accentW = Math.max(3, Math.round(8 * k));
        lines.push(`Dialogue: ${layer},${s},${e},LT,,0,0,0,,{\\an7\\p1\\bord0\\shad0\\1c${assColor(o.box_color)}&\\1a&H18&${mv(top, x)}\\fad(${fadeMs},${fadeMs})}m 0 0 l ${estW} 0 l ${estW} ${barH} l 0 ${barH}{\\p0}`);
        lines.push(`Dialogue: ${layer},${s},${e},LT,,0,0,0,,{\\an7\\p1\\bord0\\shad0\\1c${assColor(o.color)}&${mv(top, x)}\\fad(${fadeMs},${fadeMs})}m 0 0 l ${accentW} 0 l ${accentW} ${barH} l 0 ${barH}{\\p0}`);
        lines.push(`Dialogue: ${layer + 1},${s},${e},LT,,0,0,0,,{\\an7\\fn${fam}\\fs${fs}\\b1\\1c${assColor(o.color)}&\\bord0\\shad0${mv(top + Math.round(8 * k), x + Math.round(24 * k))}\\fad(${fadeMs},${fadeMs})}${assText(o.text)}`);
        if (o.subtitle) lines.push(`Dialogue: ${layer + 1},${s},${e},LT,,0,0,0,,{\\an7\\fn${fam}\\fs${subFs}\\b0\\1c${assColor(o.color)}&\\1a&H30&\\bord0\\shad0${mv(top + Math.round(8 * k + fs * 1.2), x + Math.round(24 * k))}\\fad(${fadeMs},${fadeMs})}${assText(o.subtitle)}`);
        return;
      }
      if (o.kind === 'callout') {
        const path = arrowPath(x, y, R.x + o.tx * R.w, R.y + o.ty * R.h, Math.max(5, Math.round(9 * k)));
        lines.push(`Dialogue: ${layer},${s},${e},FX,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c${assColor(o.box ? o.box_color : o.color)}&\\bord${Math.max(1, Math.round(2 * k))}\\3c&H000000&\\shad0\\fad(${fadeMs},${fadeMs})}${path}{\\p0}`);
      }
      const tags: string[] = ['\\an5', `\\fn${fam}`, `\\fs${fs}`, `\\1c${assColor(o.color)}&`];
      if (o.box) tags.push(`\\3c${assColor(o.box_color)}&`, `\\4c${assColor(o.box_color)}&`);
      const style = o.box ? 'Box' : 'Plain';
      switch (o.animation) {
        case 'fade': tags.push(`\\pos(${x},${y})`, `\\fad(${fadeMs},${fadeMs})`); break;
        case 'slide_up': tags.push(`\\move(${x},${y + Math.round(48 * k)},${x},${y},0,${Math.min(400, durMs)})`, `\\fad(${fadeMs},${fadeMs})`); break;
        case 'slide_left': tags.push(`\\move(${x + Math.round(80 * k)},${y},${x},${y},0,${Math.min(400, durMs)})`, `\\fad(${fadeMs},${fadeMs})`); break;
        case 'pop':
          tags.push(`\\pos(${x},${y})`, '\\fscx30\\fscy30', `\\t(0,${Math.min(180, durMs)},\\fscx110\\fscy110)`, `\\t(${Math.min(180, durMs)},${Math.min(300, durMs)},\\fscx100\\fscy100)`, `\\fad(0,${fadeMs})`);
          break;
        case 'typewriter': {
          // One event per reveal step (2 chars); hidden chars keep the line width stable.
          const text = o.text;
          const steps = Math.ceil(text.length / 2);
          const stepS = Math.min(1 / 15, (o.end - o.start) / Math.max(1, steps) / 2);
          for (let st = 1; st <= steps; st++) {
            const t0 = o.start + (st - 1) * stepS;
            const t1 = st === steps ? o.end : o.start + st * stepS;
            lines.push(`Dialogue: ${layer},${assTime(t0)},${assTime(t1)},${style},,0,0,0,,{${tags.join('')}\\pos(${x},${y})}${assText(text.slice(0, st * 2))}{\\alpha&HFF&}${assText(text.slice(st * 2))}`);
          }
          return;
        }
        default: tags.push(`\\pos(${x},${y})`);
      }
      lines.push(`Dialogue: ${layer},${s},${e},${style},,0,0,0,,{${tags.join('')}}${assText(o.text)}`);
    });
  if (opts?.disclosure) {
    const d = opts.disclosure;
    const m = Math.round(Math.min(W, H) * 0.03);
    const an = { tl: 7, tr: 9, bl: 1, br: 3 }[d.position];
    const px = d.position.endsWith('l') ? m : W - m;
    const py = d.position.startsWith('t') ? m : H - m;
    lines.push(`Dialogue: 90,0:00:00.00,${assTime(d.total)},Badge,,0,0,0,,{\\an${an}\\pos(${px},${py})}AI-generated voice`);
  }
  return (
    assHeader(W, H, [
      `Style: Box,Liberation Sans,56,&H00FFFFFF,&H00FFFFFF,&H005C2E0B,&H005C2E0B,-1,0,0,0,100,100,0,0,3,${Math.round(14 * k)},0,5,40,40,40,1`,
      `Style: Plain,Liberation Sans,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(3 * k))},${Math.max(1, Math.round(2 * k))},5,40,40,40,1`,
      'Style: LT,Liberation Sans,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
      'Style: FX,Liberation Sans,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
      `Style: Badge,Liberation Sans,${Math.round(22 * k)},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,3,${Math.round(6 * k)},0,9,0,0,0,1`,
    ]) + lines.join('\n') + '\n'
  );
}

/** Captions from voice word timings, styled by the caption style engine. */
export function buildCaptionsAss(
  words: VoiceoverWord[],
  style: VoiceoverCaptionStyle,
  W: number,
  H: number,
  fonts: FontResolver = builtinFonts,
): string {
  const c = resolveCaptionStyle(style);
  // Presets are authored for a 1080-wide vertical frame or a 1080-tall frame.
  const k = W < H ? W / 1080 : H / 1080;
  const fs = Math.round(c.size * k);
  const an = c.position === 'top' ? 8 : c.position === 'middle' ? 5 : 2;
  const marginV = Math.round(c.margin * H);
  const back = assColor(c.box_color, Math.round((1 - c.box_opacity) * 255));
  const fam = fonts(c.font);
  const styleLine = `Style: Cap,${fam},${fs},${assColor(c.color)},${assColor(c.color)},${c.box ? back : '&H00000000'},${c.box ? back : '&H80000000'},${c.bold ? -1 : 0},0,0,0,100,100,0,0,${c.box ? 3 : 1},${c.box ? Math.round(12 * k) : Math.max(2, Math.round(3 * k))},${c.box ? 0 : 1},${an},60,60,${marginV},1`;
  const pos = c.position === 'middle' ? `\\pos(${Math.round(W / 2)},${Math.round(H / 2)})` : '';
  const fmt = (w: string) => assText(c.uppercase ? w.toUpperCase() : w);
  const out: string[] = [];
  for (const line of captionLines(words, c.words_per_line)) {
    const lineEnd = line.end + 0.12;
    if (c.animation === 'karaoke' || c.animation === 'pop') {
      line.words.forEach((w, i) => {
        const t0 = w.start;
        const t1 = i < line.words.length - 1 ? line.words[i + 1].start : lineEnd;
        if (t1 <= t0) return;
        const text = line.words
          .map((x, j) => {
            if (j !== i) return fmt(x.word);
            const pop = c.animation === 'pop' ? '\\t(0,90,\\fscx118\\fscy118)\\t(90,180,\\fscx106\\fscy106)' : '';
            return `{\\1c${assColor(c.highlight_color)}&${pop}}${fmt(x.word)}{\\1c${assColor(c.color)}&\\fscx100\\fscy100}`;
          })
          .join(' ');
        out.push(`Dialogue: 0,${assTime(t0)},${assTime(t1)},Cap,,0,0,0,,{${pos}}${text}`);
      });
    } else {
      const fade = c.animation === 'fade' ? '\\fad(120,120)' : '';
      out.push(`Dialogue: 0,${assTime(line.start)},${assTime(lineEnd)},Cap,,0,0,0,,{${pos}${fade}}${line.words.map((w) => fmt(w.word)).join(' ')}`);
    }
  }
  return assHeader(W, H, [styleLine]) + out.join('\n') + '\n';
}
