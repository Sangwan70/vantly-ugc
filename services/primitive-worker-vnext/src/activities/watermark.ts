// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Optional final post-processing step: burns a user-supplied watermark text
 * onto an already-rendered video. Reuses the same proven approach as
 * subtitles.ts (an ASS subtitle track rendered via ffmpeg's `ass=` filter,
 * libass + fontconfig) rather than ffmpeg's `drawtext` filter, since drawtext
 * needs a font FILE path wired in at build time and this codebase has no
 * such wiring; the ASS path is already production-proven here.
 *
 * This is intentionally lightweight compared to compose-broll-overlay.ts's
 * primitive: it does not record its own primitive_runs row. The calling
 * workflow's OWN skill_runs/primitive_runs row already tracks the overall
 * job; this activity is a pure video-in, video-out transform bolted onto the
 * end of it (make_ugc_video / make_simple_selfie / make_broll_talking_head).
 */

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '../config.js';
import { r2UploadVnext } from '../client/r2.js';

const execFileP = promisify(execFile);

type AspectRatio = '9:16' | '1:1' | '16:9';

const RES: Record<AspectRatio, { x: number; y: number }> = {
  '9:16': { x: 1080, y: 1920 },
  '16:9': { x: 1920, y: 1080 },
  '1:1': { x: 1080, y: 1080 },
};

function escapeAss(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const MAX_WATERMARK_CHARS = 40;

/** A small, semi-transparent, bottom-center line that persists for the whole clip. */
function generateWatermarkAss(text: string, aspectRatio: AspectRatio, durationSeconds: number): string {
  const res = RES[aspectRatio] ?? RES['9:16'];
  const clean = text.trim().slice(0, MAX_WATERMARK_CHARS);
  const fontSize = Math.round(res.x * 0.032);
  const header = `[Script Info]
Title: Watermark
ScriptType: v4.00+
PlayResX: ${res.x}
PlayResY: ${res.y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Watermark,Liberation Sans,${fontSize},&H80FFFFFF,&H80FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${formatAssTime(0)},${formatAssTime(durationSeconds)},Watermark,,0,0,0,,${escapeAss(clean)}
`;
  return header;
}

export interface WatermarkActivityInput {
  primitive_run_id: string;
  user_id: string;
  video_url: string;
  text: string;
  aspect_ratio: AspectRatio;
}

export interface WatermarkActivityResult {
  video_url: string;
}

export function makeWatermarkActivity(cfg: WorkerConfig) {
  return async function applyWatermark(input: WatermarkActivityInput): Promise<WatermarkActivityResult> {
    const text = input.text.trim();
    if (!text) return { video_url: input.video_url };

    const workDir = await mkdtemp(join(tmpdir(), 'watermark-'));
    try {
      const srcResp = await fetch(input.video_url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!srcResp.ok) throw new Error(`watermark: source video download failed (${srcResp.status})`);
      const srcPath = join(workDir, 'src.mp4');
      await writeFile(srcPath, Buffer.from(await srcResp.arrayBuffer()));

      const { stdout: durOut } = await execFileP('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        srcPath,
      ]);
      const durationSeconds = Math.max(1, parseFloat(durOut.trim()) || 1);

      const assPath = join(workDir, 'watermark.ass');
      await writeFile(assPath, generateWatermarkAss(text, input.aspect_ratio, durationSeconds));

      const outPath = join(workDir, 'out.mp4');
      await execFileP('ffmpeg', [
        '-y',
        '-i', srcPath,
        '-vf', `ass=${assPath}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'copy',
        outPath,
      ]);

      const outBytes = await readFile(outPath);
      const { publicUrl } = await r2UploadVnext(
        cfg.r2,
        input.primitive_run_id,
        'watermarked.mp4',
        outBytes,
        'video/mp4',
      );
      return { video_url: publicUrl };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
