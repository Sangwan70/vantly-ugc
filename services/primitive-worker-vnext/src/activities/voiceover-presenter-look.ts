// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceover_presenter_look — dress the Voiceover Studio presenter.
 *
 * gpt-image redraws the user's own photo as a head-and-shoulders presenter
 * portrait in the outfit they asked for ("a navy blue suit, white shirt and
 * tie"), with a closed-mouth smile and the series' setting. That one image then
 * drives every presenter take, so an outfit stays identical across a whole run
 * of episodes. Always starts from the original upload, never from a previous
 * outfit, so the face doesn't drift. Free, like portrait_gpt2.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { VoiceoverPresenterLookInputSchema } from '@vantly-ugc/schema';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { classifyOpenAIError, generateImageWithFallback } from '../client/openai.js';
import { deductPrimitiveCredits } from '../client/credits.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { storageRegions } from './voiceover-render.js';

const execFileP = promisify(execFile);

export interface VoiceoverPresenterLookActivityInput {
  primitive_run_id: string;
  user_id: string;
  input: unknown;
}

export interface VoiceoverPresenterLookActivityResult {
  primitive_run_id: string;
  image_url: string;
  artifact_id: string;
}

export function presenterLookPrompt(outfit: string, scene: string): string {
  return [
    'Photorealistic head-and-shoulders portrait photo of the person in the reference image.',
    'Keep their exact face and identity: age, skin tone, face shape, hairline and hairstyle, glasses and facial hair exactly as in the reference.',
    `They now wear ${outfit.trim().replace(/\.$/, '')}, neatly fitted and well pressed.`,
    'Calm, friendly, confident expression with a gentle closed-mouth smile: lips together, no teeth showing.',
    'Looking straight into the camera, centred, square framing with a little space above the head, shoulders visible.',
    `Background: ${scene.trim() || 'a softly blurred, bright modern office'}.`,
    'Soft, even, natural light; natural matte skin; a real camera photo. No text, no logos, no watermark.',
  ].join(' ');
}

export function makeVoiceoverPresenterLookActivity(cfg: WorkerConfig) {
  return async function voiceoverPresenterLook(activityInput: VoiceoverPresenterLookActivityInput): Promise<VoiceoverPresenterLookActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const runId = activityInput.primitive_run_id;
    const parsed = VoiceoverPresenterLookInputSchema.safeParse(activityInput.input);
    if (!parsed.success) throw ApplicationFailure.nonRetryable(`voiceover_presenter_look input invalid: ${parsed.error.message}`, 'INVALID_INPUT');
    const input = parsed.data;

    const { data: existing, error: existingErr } = await db.from('primitive_runs').select('status, primitive_artifacts(id, url)').eq('id', runId).maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing?.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (art) return { primitive_run_id: runId, image_url: art.url, artifact_id: art.id };
    }

    const regions = storageRegions(cfg.r2);
    const store = regions[input.storage_region ?? 'default'] ?? regions.default;
    if (!Object.values(regions).some((r) => input.source_url.startsWith(r.publicUrl.replace(/\/+$/, '') + '/'))) {
      throw ApplicationFailure.nonRetryable('the photo must be hosted on our storage', 'REFERENCE_URL_NOT_ALLOWED');
    }

    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      { id: runId, user_id: activityInput.user_id, primitive_id: 'voiceover_presenter_look', status: 'running', input, started_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);
    await deductPrimitiveCredits({ db, userId: activityInput.user_id, primitiveRunId: runId, primitive: 'voiceover_presenter_look', creditsOverride: 0, description: 'Voiceover Studio presenter outfit' });

    const workDir = await mkdtemp(join(tmpdir(), `vnext-presenter-look-${runId}-`));
    try {
      // gpt-image edits take PNG references.
      const resp = await fetch(input.source_url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`photo download ${resp.status}`);
      const rawPath = join(workDir, 'source');
      const pngPath = join(workDir, 'source.png');
      await writeFile(rawPath, Buffer.from(await resp.arrayBuffer()));
      await execFileP('ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-frames:v', '1', '-vf', "scale='min(1536,iw)':-2", pngPath]);
      Context.current().heartbeat({ stage: 'photo_ready' });

      const referencePng = await readFile(pngPath);
      let bytes: Buffer;
      try {
        const out = await withHeartbeat('gpt_image', () => generateImageWithFallback(cfg.openai, {
          model: cfg.openai.imageModel,
          prompt: presenterLookPrompt(input.outfit, input.scene),
          referencePng,
          size: '1024x1024',
        }));
        bytes = out.bytes;
      } catch (err) {
        const c = classifyOpenAIError(err);
        if (c.retryable) throw err instanceof Error ? err : new Error(String(err));
        throw ApplicationFailure.nonRetryable(
          c.isContentPolicyViolation ? 'The image service refused this photo or outfit. Try a different photo or describe the outfit differently.' : c.message,
          c.isContentPolicyViolation ? 'CONTENT_MODERATION' : c.code,
        );
      }

      const { publicUrl } = await r2UploadVnext(store, runId, 'presenter-look.png', bytes, 'image/png');
      const { data: artifact, error: artErr } = await db
        .from('primitive_artifacts')
        .insert({ primitive_run_id: runId, kind: 'voiceover_presenter_look', url: publicUrl, bytes: bytes.byteLength, mime: 'image/png', metadata: { project_id: input.project_id, outfit: input.outfit } })
        .select('id')
        .single();
      if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);
      const { error: finErr } = await db.from('primitive_runs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', runId);
      if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);
      return { primitive_run_id: runId, image_url: publicUrl, artifact_id: artifact.id as string };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

