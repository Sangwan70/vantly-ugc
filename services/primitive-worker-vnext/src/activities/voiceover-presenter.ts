// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceover_presenter — Voiceover Studio presenter take.
 *
 * The user, from their own photo (+ an optional frame of them talking), speaking
 * one narration block, lip-synced to that block's ElevenLabs take. Seedance 2.0
 * reference-to-video via EvoLink, 720p — 1:1 for the corner circle, the video's
 * own shape over a title card — exactly as long as the audio that plays (4–15 s). The output is SILENT: the render overlays it in a circle and
 * the block's own voice track stays the only sound.
 *
 * The editor caches the clip on the block under clip_key, so re-renders, other
 * formats and caption/music changes never pay for a take twice.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { VoiceoverPresenterTakeInputSchema, presenterTakeSeconds, quotePresenterCredits } from '@vantly-ugc/schema';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { generatePresenterEvolink } from '../client/evolink.js';
import { deductPrimitiveCredits, isAdminUser, refundPrimitiveCredits } from '../client/credits.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { storageRegions } from './voiceover-render.js';

const execFileP = promisify(execFile);

export interface VoiceoverPresenterActivityInput {
  primitive_run_id: string;
  user_id: string;
  input: unknown;
}

export interface VoiceoverPresenterActivityResult {
  primitive_run_id: string;
  video_url: string;
  clip_key: string;
  artifact_id: string;
}

// EvoLink Seedance 2.0 720p ≈ $0.199/s, ×1.1 with the real-person filter relaxed.
const USD_PER_SECOND = 0.22;

async function fetchToBuffer(url: string, label: string): Promise<Buffer> {
  const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`${label} download ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

export function makeVoiceoverPresenterActivity(cfg: WorkerConfig) {
  return async function voiceoverPresenter(activityInput: VoiceoverPresenterActivityInput): Promise<VoiceoverPresenterActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const runId = activityInput.primitive_run_id;
    const parsed = VoiceoverPresenterTakeInputSchema.safeParse(activityInput.input);
    if (!parsed.success) throw ApplicationFailure.nonRetryable(`voiceover_presenter input invalid: ${parsed.error.message}`, 'INVALID_INPUT');
    const input = parsed.data;

    // Retry-safety: a finished take is returned as-is.
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, primitive_artifacts(id, url)')
      .eq('id', runId)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing?.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (art) return { primitive_run_id: runId, video_url: art.url, clip_key: input.clip_key, artifact_id: art.id };
    }

    // Storage region + SSRF guard: everything we fetch or hand to EvoLink must be ours.
    const regions = storageRegions(cfg.r2);
    const store = regions[input.storage_region ?? 'default'] ?? regions.default;
    const prefixes = Object.values(regions).map((r) => r.publicUrl.replace(/\/+$/, '') + '/');
    for (const u of [input.photo_url, input.style_url, input.audio_url]) {
      if (u && !prefixes.some((p) => u.startsWith(p))) {
        throw ApplicationFailure.nonRetryable('all media must be hosted on our storage', 'REFERENCE_URL_NOT_ALLOWED');
      }
    }

    const seconds = presenterTakeSeconds(input.audio_length);
    const estimatedUsd = Math.round(seconds * USD_PER_SECOND * 100) / 100;
    const isAdmin = await isAdminUser(db, activityInput.user_id);
    if (!isAdmin && estimatedUsd > cfg.caps.primitiveUsd) {
      throw ApplicationFailure.nonRetryable(`estimated $${estimatedUsd} exceeds per-primitive cap $${cfg.caps.primitiveUsd}`, 'BUDGET_CAP_PRIMITIVE');
    }

    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: runId,
        user_id: activityInput.user_id,
        primitive_id: 'voiceover_presenter',
        status: 'running',
        input: { ...input, duration: seconds },
        estimated_credits_usd: estimatedUsd,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: activityInput.user_id,
      primitiveRunId: runId,
      primitive: 'voiceover_presenter',
      creditsOverride: quotePresenterCredits(input.audio_length),
      description: `Voiceover Studio presenter take (${seconds}s)`,
    });

    const workDir = await mkdtemp(join(tmpdir(), `vnext-presenter-${runId}-`));
    try {
      // 1. The exact audio that plays (the block may be trimmed), at least 2 s (EvoLink's minimum).
      const takePath = join(workDir, 'take.mp3');
      const cutPath = join(workDir, 'speech.mp3');
      await writeFile(takePath, await fetchToBuffer(input.audio_url, 'voice take'));
      await execFileP('ffmpeg', [
        '-y', '-v', 'error', '-i', takePath,
        '-ss', input.audio_in.toFixed(3), '-t', input.audio_length.toFixed(3),
        '-af', 'apad=whole_dur=2', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', cutPath,
      ]);
      const speech = await r2UploadVnext(store, runId, 'presenter-speech.mp3', await readFile(cutPath), 'audio/mpeg');
      Context.current().heartbeat({ stage: 'speech_ready' });

      // 2. The take.
      let providerTaskId: string | null = null;
      let videoBytes: Buffer;
      if (cfg.openai.simulate) {
        videoBytes = Buffer.from('SIMULATED', 'utf8');
      } else {
        try {
          const result = await withHeartbeat('seedance_working', () => generatePresenterEvolink({
            photoUrl: input.photo_url,
            styleUrl: input.style_url,
            audioUrl: speech.publicUrl,
            duration: seconds,
            scene: input.scene,
            aspect: input.frame,
          }));
          providerTaskId = result.taskId;
          videoBytes = await fetchToBuffer(result.videoUrl, 'presenter video');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number })?.status;
          // A refused photo won't pass on retry — tell the user straight away.
          if (/moderation|sensitive|real person|privacy/i.test(msg)) {
            throw ApplicationFailure.nonRetryable('EvoLink refused this photo. Try a clear, front-facing photo of yourself.', 'CONTENT_MODERATION');
          }
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 402) {
            throw ApplicationFailure.nonRetryable(`evolink ${status}: ${msg}`, `EVOLINK_${status}`);
          }
          throw err instanceof Error ? err : new Error(msg);
        }
      }
      Context.current().heartbeat({ stage: 'video_downloaded', bytes: videoBytes.byteLength });

      const { publicUrl } = await r2UploadVnext(store, runId, 'presenter.mp4', videoBytes, 'video/mp4');

      if (providerTaskId) {
        await db.from('provider_tasks').insert({ primitive_run_id: runId, provider: 'seedance-2-0', external_task_id: providerTaskId, status: 'succeeded', raw_response: {} });
      }
      const { data: artifact, error: artErr } = await db
        .from('primitive_artifacts')
        .insert({
          primitive_run_id: runId,
          kind: 'voiceover_presenter',
          url: publicUrl,
          bytes: videoBytes.byteLength,
          mime: 'video/mp4',
          metadata: { project_id: input.project_id, block_id: input.block_id, clip_key: input.clip_key, frame: input.frame, seconds, simulated: cfg.openai.simulate },
        })
        .select('id')
        .single();
      if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);

      const { error: finErr } = await db
        .from('primitive_runs')
        .update({ status: 'succeeded', actual_credits_usd: estimatedUsd, finished_at: new Date().toISOString(), provider_task_id: providerTaskId })
        .eq('id', runId);
      if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

      return { primitive_run_id: runId, video_url: publicUrl, clip_key: input.clip_key, artifact_id: artifact.id as string };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) await refundPrimitiveCredits(db, runId);
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
