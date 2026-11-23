// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio render plan → ffmpeg arguments.
 *
 * Pure functions only (no I/O) so the whole plan is unit-testable. The render
 * is two-stage, on purpose:
 *
 *   1. one segment per clip   — frame-accurate seek into the source, speed,
 *                               zoom/pan, fades, normalised to the content box
 *                               at 30 fps. Memory stays flat no matter how many
 *                               cuts the user made, and each segment is a
 *                               natural progress/heartbeat point.
 *   2. one final pass         — concat the segments (stream copy demuxer),
 *                               place them on the output canvas (blur / black
 *                               bars / cover), burn text animations + captions
 *                               (ASS/libass), and mix the voice blocks at their
 *                               timeline positions.
 */

import type { TextOverlay, VoiceoverClip, VoiceoverOutput } from '@vantly-ugc/schema';
import { clipOutputDuration } from '@vantly-ugc/schema';

export const RENDER_FPS = 30;

export interface Canvas {
  /** Output frame. */
  W: number;
  H: number;
  /** Size each clip segment is normalised to (the recording's box on the canvas). */
  cw: number;
  ch: number;
  /** Fill the canvas by cropping instead of letter/pillar-boxing. */
  cover: boolean;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function computeCanvas(
  source: { width: number; height: number },
  output: Pick<VoiceoverOutput, 'aspect' | 'fit'>,
): Canvas {
  const { width: sw, height: sh } = source;
  let W: number;
  let H: number;
  switch (output.aspect) {
    case '16:9': W = 1920; H = 1080; break;
    case '9:16': W = 1080; H = 1920; break;
    case '1:1': W = 1080; H = 1080; break;
    default: {
      const k = Math.min(1, 1920 / Math.max(sw, sh));
      W = even(sw * k);
      H = even(sh * k);
    }
  }
  if (output.aspect === 'source' || output.fit === 'cover') {
    return { W, H, cw: W, ch: H, cover: output.aspect !== 'source' };
  }
  const k = Math.min(W / sw, H / sh);
  return { W, H, cw: Math.min(W, even(sw * k)), ch: Math.min(H, even(sh * k)), cover: false };
}

const num = (n: number) => Number(n.toFixed(4)).toString();

/** atempo only accepts 0.5–2.0 per instance; chain for anything outside. */
export function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${num(s)}`);
  return parts;
}

/**
 * zoompan expression for a clip. `on` is the output frame number; with d=1
 * zoompan emits exactly one frame per input frame, so time = on / fps.
 * Eases with smoothstep so pushes don't start/stop abruptly.
 */
export function zoomFilter(clip: VoiceoverClip, cw: number, ch: number): string | null {
  const z = clip.zoom;
  if (!z || z.mode === 'none' || z.scale <= 1.001) return null;
  const frames = Math.max(1, Math.round(clipOutputDuration(clip) * RENDER_FPS));
  const S = num(z.scale);
  const smooth = (p: string) => `(${p})*(${p})*(3-2*(${p}))`;
  let zexpr: string;
  if (z.mode === 'in') {
    const p = `min(on/${frames},1)`;
    zexpr = `1+(${S}-1)*${smooth(p)}`;
  } else if (z.mode === 'out') {
    const p = `min(on/${frames},1)`;
    zexpr = `${S}-(${S}-1)*${smooth(p)}`;
  } else {
    const easeFrames = Math.round(Math.min(z.ease, clipOutputDuration(clip) / 2) * RENDER_FPS);
    if (easeFrames <= 0) {
      zexpr = S;
    } else {
      const p = `min(min(on/${easeFrames},(${frames}-on)/${easeFrames}),1)`;
      zexpr = `1+(${S}-1)*${smooth(`max(${p},0)`)}`;
    }
  }
  const fx = num(z.x);
  const fy = num(z.y);
  const x = `max(0,min(iw-iw/zoom,${fx}*iw-iw/zoom/2))`;
  const y = `max(0,min(ih-ih/zoom,${fy}*ih-ih/zoom/2))`;
  return `zoompan=z='${zexpr}':x='${x}':y='${y}':d=1:s=${cw}x${ch}:fps=${RENDER_FPS}`;
}

export interface SegmentPlan {
  srcPath: string;
  outPath: string;
  clip: VoiceoverClip;
  canvas: Canvas;
  /** Keep the recording's own audio for this segment (only when it has audio and it's wanted). */
  withAudio: boolean;
}

export function buildSegmentArgs(p: SegmentPlan): string[] {
  const { clip, canvas } = p;
  const d = clipOutputDuration(clip);
  const vf: string[] = [`setpts=(PTS-STARTPTS)/${num(clip.speed)}`, `fps=${RENDER_FPS}`];
  if (canvas.cover) {
    vf.push(`scale=${canvas.cw}:${canvas.ch}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${canvas.cw}:${canvas.ch}`);
  } else {
    vf.push(`scale=${canvas.cw}:${canvas.ch}:flags=lanczos`);
  }
  vf.push('setsar=1');
  const zoom = zoomFilter(clip, canvas.cw, canvas.ch);
  if (zoom) vf.push(zoom);
  if (clip.fade_in > 0) vf.push(`fade=t=in:st=0:d=${num(Math.min(clip.fade_in, d / 2))}`);
  if (clip.fade_out > 0) {
    const f = Math.min(clip.fade_out, d / 2);
    vf.push(`fade=t=out:st=${num(Math.max(0, d - f))}:d=${num(f)}`);
  }
  vf.push('format=yuv420p');

  const args = [
    '-y', '-hide_banner', '-nostdin',
    '-ss', num(clip.src_in), '-to', num(clip.src_out),
    '-i', p.srcPath,
    '-vf', vf.join(','),
  ];
  if (p.withAudio) {
    const af = ['asetpts=PTS-STARTPTS', ...atempoChain(clip.speed), 'aresample=48000', 'aformat=channel_layouts=stereo'];
    if (clip.fade_in > 0) af.push(`afade=t=in:st=0:d=${num(Math.min(clip.fade_in, d / 2))}`);
    if (clip.fade_out > 0) {
      const f = Math.min(clip.fade_out, d / 2);
      af.push(`afade=t=out:st=${num(Math.max(0, d - f))}:d=${num(f)}`);
    }
    args.push('-af', af.join(','), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  } else {
    args.push('-an');
  }
  args.push(
    '-t', num(d),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-r', String(RENDER_FPS), '-video_track_timescale', '15360',
    p.outPath,
  );
  return args;
}

export function concatListFile(segmentPaths: string[]): string {
  return segmentPaths.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

export interface VoiceInput {
  path: string;
  /** Output-timeline start (seconds). */
  start: number;
  volume: number;
}

export interface FinalPlan {
  concatListPath: string;
  voices: VoiceInput[];
  canvas: Canvas;
  fit: VoiceoverOutput['fit'];
  overlayAssPath?: string;
  captionsAssPath?: string;
  /** Segments carry the recording's audio; mix it at this volume. 0 / undefined = none. */
  originalVolume?: number;
  total: number;
  outPath: string;
}

export function buildFinalArgs(p: FinalPlan): string[] {
  const { canvas } = p;
  const graph: string[] = [];
  let v = '[0:v]';

  if (canvas.cw !== canvas.W || canvas.ch !== canvas.H) {
    if (p.fit === 'black') {
      graph.push(`${v}pad=${canvas.W}:${canvas.H}:(ow-iw)/2:(oh-ih)/2:color=black[vcan]`);
    } else {
      graph.push(
        `${v}split[bgsrc][fg]`,
        `[bgsrc]scale=${canvas.W}:${canvas.H}:force_original_aspect_ratio=increase,crop=${canvas.W}:${canvas.H},boxblur=24:2,eq=brightness=-0.08[bg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[vcan]`,
      );
    }
    v = '[vcan]';
  }
  if (p.overlayAssPath) {
    graph.push(`${v}ass=filename=${escapeFilterPath(p.overlayAssPath)}[vtxt]`);
    v = '[vtxt]';
  }
  if (p.captionsAssPath) {
    graph.push(`${v}ass=filename=${escapeFilterPath(p.captionsAssPath)}[vcap]`);
    v = '[vcap]';
  }
  graph.push(`${v}format=yuv420p[vout]`);

  const audioLabels: string[] = [];
  if (p.originalVolume && p.originalVolume > 0) {
    graph.push(`[0:a]volume=${num(p.originalVolume)}[orig]`);
    audioLabels.push('[orig]');
  }
  p.voices.forEach((voice, i) => {
    const ms = Math.max(0, Math.round(voice.start * 1000));
    graph.push(
      `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${num(voice.volume)},adelay=${ms}|${ms}[vo${i}]`,
    );
    audioLabels.push(`[vo${i}]`);
  });
  if (audioLabels.length === 0) {
    graph.push(`anullsrc=r=48000:cl=stereo[aout]`);
  } else if (audioLabels.length === 1) {
    graph.push(`${audioLabels[0]}apad[aout]`);
  } else {
    graph.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[aout]`);
  }

  const args = ['-y', '-hide_banner', '-nostdin', '-f', 'concat', '-safe', '0', '-i', p.concatListPath];
  for (const voice of p.voices) args.push('-i', voice.path);
  args.push(
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', num(p.total),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(RENDER_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    p.outPath,
  );
  return args;
}

/** Paths inside a filtergraph: escape the characters the parser treats specially. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

// ── Text overlays → ASS ─────────────────────────────────────────────────────

function assTime(t: number): string {
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
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

function assText(s: string): string {
  return s.replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

export function buildOverlayAss(overlays: TextOverlay[], W: number, H: number): string {
  const k = H / 1080;
  const header = `[Script Info]
Title: Voiceover Studio overlays
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Box,Liberation Sans,56,&H00FFFFFF,&H00FFFFFF,&H005C2E0B,&H005C2E0B,-1,0,0,0,100,100,0,0,3,${Math.round(14 * k)},0,5,40,40,40,1
Style: Plain,Liberation Sans,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(3 * k))},${Math.max(1, Math.round(2 * k))},5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = overlays
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((o, i) => {
      const x = Math.round(o.x * W);
      const y = Math.round(o.y * H);
      const fs = Math.round(o.size * k);
      const tags: string[] = ['\\an5', `\\fs${fs}`, `\\1c${assColor(o.color)}&`];
      if (o.box) tags.push(`\\3c${assColor(o.box_color)}&`, `\\4c${assColor(o.box_color)}&`);
      const durMs = Math.round((o.end - o.start) * 1000);
      const fadeMs = Math.min(250, Math.floor(durMs / 3));
      switch (o.animation) {
        case 'fade':
          tags.push(`\\pos(${x},${y})`, `\\fad(${fadeMs},${fadeMs})`);
          break;
        case 'slide_up': {
          const dy = Math.round(48 * k);
          tags.push(`\\move(${x},${y + dy},${x},${y},0,${Math.min(400, durMs)})`, `\\fad(${fadeMs},${fadeMs})`);
          break;
        }
        case 'pop':
          tags.push(
            `\\pos(${x},${y})`,
            '\\fscx30\\fscy30',
            `\\t(0,${Math.min(180, durMs)},\\fscx110\\fscy110)`,
            `\\t(${Math.min(180, durMs)},${Math.min(300, durMs)},\\fscx100\\fscy100)`,
            `\\fad(0,${fadeMs})`,
          );
          break;
        default:
          tags.push(`\\pos(${x},${y})`);
      }
      return `Dialogue: ${i},${assTime(o.start)},${assTime(o.end)},${o.box ? 'Box' : 'Plain'},,0,0,0,,{${tags.join('')}}${assText(o.text)}`;
    });
  return header + lines.join('\n') + '\n';
}

/** Nearest caption layout preset for an output frame. */
export function captionAspect(W: number, H: number): '9:16' | '16:9' | '1:1' {
  const r = W / H;
  if (r > 1.2) return '16:9';
  if (r < 0.8) return '9:16';
  return '1:1';
}
