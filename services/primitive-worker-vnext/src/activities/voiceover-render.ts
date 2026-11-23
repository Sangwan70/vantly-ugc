// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceover_render — Voiceover Studio export.
 *
 * Input: a silent screen recording + the Studio timeline (cuts, speed,
 * zoom/pan, text animations, ElevenLabs voice blocks, captions). Output: one
 * finished MP4 in R2, recorded as a primitive_artifact so it appears in the
 * Gallery and can be published to social via Vantly.
 *
 * See lib/voiceover-ffmpeg.ts for the render plan.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import {
  VoiceoverRenderInputSchema,
  quoteVoiceoverRenderCredits,
  timelineDuration,
  timelineWords,
  validateVoiceoverForRender,
} from '@vantly-ugc/schema';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { deductPrimitiveCredits, refundPrimitiveCredits } from '../client/credits.js';
import { generateAss } from '../lib/ass.js';
import {
  buildFinalArgs,
  buildOverlayAss,
  buildSegmentArgs,
  captionAspect,
  computeCanvas,
  concatListFile,
} from '../lib/voiceover-ffmpeg.js';

const execFileP = promisify(execFile);
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface VoiceoverRenderActivityInput {
  primitive_run_id: string;
  user_id: string;
  input: unknown;
}

export interface VoiceoverRenderActivityResult {
  primitive_run_id: string;
  video_url: string;
  artifact_id: string;
  duration: number;
}

async function download(url: string, dest: string, maxBytes: number): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (resp.status >= 500) throw new Error(`fetch transient ${resp.status} for ${url}`);
  if (!resp.ok || !resp.body) {
    throw ApplicationFailure.nonRetryable(`fetch failed (${resp.status}) for ${url}`, 'REFERENCE_FETCH_FAILED');
  }
  const len = Number(resp.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw ApplicationFailure.nonRetryable(`file too large (${len} bytes)`, 'REFERENCE_TOO_LARGE');
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(dest));
}

async function probe(path: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }> {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path,
  ]);
  const j = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number }>; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw ApplicationFailure.nonRetryable('source has no video stream', 'REFERENCE_NOT_VIDEO');
  return {
    width: v.width,
    height: v.height,
    duration: Number(j.format?.duration ?? 0),
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
  };
}

/** Run ffmpeg, heartbeating and reporting progress parsed from `time=`. */
function runFfmpeg(args: string[], expectedSeconds: number, onPct?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    let lastBeat = 0;
    proc.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      tail = (tail + s).slice(-4000);
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s);
      const now = Date.now();
      if (now - lastBeat > 5000) {
        lastBeat = now;
        let pct: number | undefined;
        if (m && expectedSeconds > 0) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          pct = Math.min(1, t / expectedSeconds);
          onPct?.(pct);
        }
        try { Context.current().heartbeat({ pct }); } catch { /* not in activity (tests) */ }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${tail.split('\n').slice(-6).join(' | ')}`));
    });
  });
}

export function makeVoiceoverRenderActivity(cfg: WorkerConfig) {
  return async function voiceoverRender(
    activityInput: VoiceoverRenderActivityInput,
  ): Promise<VoiceoverRenderActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const runId = activityInput.primitive_run_id;

    const parsed = VoiceoverRenderInputSchema.safeParse(activityInput.input);
    if (!parsed.success) {
      throw ApplicationFailure.nonRetryable(`voiceover_render input invalid: ${parsed.error.message}`, 'INVALID_INPUT');
    }
    const input = parsed.data;
    const problems = validateVoiceoverForRender(input);
    if (problems.length) throw ApplicationFailure.nonRetryable(problems.join('; '), 'INVALID_INPUT');

    // Retry-safety: a succeeded run returns its artifact.
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, primitive_artifacts(id, url)')
      .eq('id', runId)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing?.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (art) return { primitive_run_id: runId, video_url: art.url, artifact_id: art.id, duration: timelineDuration(input.timeline) };
    }

    // SSRF guard: every fetched URL must be ours.
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    const urls = [input.source.url, ...input.timeline.blocks.filter((b) => b.audio_url).map((b) => b.audio_url!)];
    if (urls.some((u) => !u.startsWith(allowedPrefix))) {
      throw ApplicationFailure.nonRetryable(`all media must be hosted on ${allowedPrefix}`, 'REFERENCE_URL_NOT_ALLOWED');
    }

    const total = timelineDuration(input.timeline);
    const progress = async (stage: string, pct: number) => {
      await db.from('primitive_events').insert({
        primitive_run_id: runId,
        level: 'info',
        code: 'progress',
        message: { stage, pct: Math.round(pct * 100) / 100 },
      });
    };

    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: runId,
        user_id: activityInput.user_id,
        primitive_id: 'voiceover_render',
        status: 'running',
        input: { ...input, duration: Math.round(total) },
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: activityInput.user_id,
      primitiveRunId: runId,
      primitive: 'voiceover_render',
      creditsOverride: quoteVoiceoverRenderCredits(total),
      description: `Voiceover Studio render (${Math.ceil(total)}s)`,
    });

    const workDir = await mkdtemp(join(tmpdir(), `vnext-voiceover-${runId}-`));
    try {
      await progress('downloading', 0.02);
      const srcPath = join(workDir, 'source');
      await download(input.source.url, srcPath, MAX_SOURCE_BYTES);
      const voiced = input.timeline.blocks.filter((b) => b.audio_url && b.text.trim());
      const voices = await Promise.all(
        voiced.map(async (b, i) => {
          const p = join(workDir, `voice-${i}.mp3`);
          await download(b.audio_url!, p, 50 * 1024 * 1024);
          return { path: p, start: b.start, volume: b.volume };
        }),
      );
      const meta = await probe(srcPath);
      Context.current().heartbeat({ stage: 'downloaded' });

      const out = input.timeline.output;
      const canvas = computeCanvas(meta, out);
      const withAudio = meta.hasAudio && out.original_volume > 0;

      // Stage 1: one normalised segment per clip.
      const clips = input.timeline.clips;
      const segPaths: string[] = [];
      let done = 0;
      for (let i = 0; i < clips.length; i++) {
        const clip = { ...clips[i], src_out: Math.min(clips[i].src_out, meta.duration || clips[i].src_out) };
        const seg = join(workDir, `seg-${String(i).padStart(4, '0')}.mp4`);
        await runFfmpeg(buildSegmentArgs({ srcPath, outPath: seg, clip, canvas, withAudio }), 0);
        segPaths.push(seg);
        done += (clip.src_out - clip.src_in) / clip.speed;
        Context.current().heartbeat({ stage: 'segments', i });
        if (i % 3 === 2 || i === clips.length - 1) await progress('cutting', 0.05 + 0.45 * (done / total));
      }
      const listPath = join(workDir, 'segments.txt');
      await writeFile(listPath, concatListFile(segPaths));

      // Text animations + captions.
      let overlayAssPath: string | undefined;
      if (input.timeline.overlays.length) {
        overlayAssPath = join(workDir, 'overlays.ass');
        await writeFile(overlayAssPath, buildOverlayAss(input.timeline.overlays, canvas.W, canvas.H));
      }
      let captionsAssPath: string | undefined;
      const words = timelineWords(input.timeline).filter((w) => w.start < total);
      if (out.captions.enabled && words.length) {
        captionsAssPath = join(workDir, 'captions.ass');
        await writeFile(captionsAssPath, generateAss(words, out.captions.style, captionAspect(canvas.W, canvas.H)));
      }

      // Stage 2: canvas + text + captions + voice mix.
      await progress('rendering', 0.5);
      const outPath = join(workDir, 'voiceover.mp4');
      let lastReported = 0.5;
      await runFfmpeg(
        buildFinalArgs({
          concatListPath: listPath,
          voices,
          canvas,
          fit: out.fit,
          overlayAssPath,
          captionsAssPath,
          originalVolume: withAudio ? out.original_volume : 0,
          total,
          outPath,
        }),
        total,
        (pct) => {
          const overall = 0.5 + 0.45 * pct;
          if (overall - lastReported >= 0.05) {
            lastReported = overall;
            void progress('rendering', overall);
          }
        },
      );

      await progress('uploading', 0.96);
      const size = (await stat(outPath)).size;
      const bytes = await readFile(outPath);
      const { publicUrl } = await r2UploadVnext(cfg.r2, runId, 'voiceover.mp4', bytes, 'video/mp4');

      const { data: artifact, error: artErr } = await db
        .from('primitive_artifacts')
        .insert({
          primitive_run_id: runId,
          kind: 'voiceover_video',
          url: publicUrl,
          bytes: size,
          mime: 'video/mp4',
          metadata: {
            project_id: input.project_id,
            width: canvas.W,
            height: canvas.H,
            duration: total,
            clips: clips.length,
            voice_blocks: voices.length,
            overlays: input.timeline.overlays.length,
            captions: Boolean(captionsAssPath),
          },
        })
        .select('id')
        .single();
      if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);

      const { error: finErr } = await db
        .from('primitive_runs')
        .update({ status: 'succeeded', finished_at: new Date().toISOString() })
        .eq('id', runId);
      if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);
      await progress('done', 1);

      return { primitive_run_id: runId, video_url: publicUrl, artifact_id: artifact.id as string, duration: total };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await refundPrimitiveCredits(db, runId);
      }
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
