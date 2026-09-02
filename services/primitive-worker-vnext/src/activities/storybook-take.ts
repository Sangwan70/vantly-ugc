// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * make_storybook step 2 (per scene, per chunk) — animate the SPEAKING
 * character's locked stylized design into a talking take for one scene, in
 * the SAME illustrated art style, native Seedance voice.
 *
 * Structurally this is simple-selfie.ts's chunking/duration-bucket/voice-
 * continuity approach, but it is its own activity (not a reuse of
 * simpleSelfie) because the prompt language is entirely new — cartoon/
 * illustrated style, never the photoreal skin-texture/wardrobe-lock clauses
 * simple-selfie always adds. Internal to the make_storybook workflow only
 * (not its own SkillEntry/tool), so the input is a plain typed shape rather
 * than a public Zod tool schema.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import type { StorybookArtStyle } from '@vantly-ugc/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext } from '../client/r2.js';
import { generateSimpleSelfieEvolink } from '../client/evolink.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { deductPrimitiveCredits, refundPrimitiveCredits, isAdminUser } from '../client/credits.js';
import { STORYBOOK_ART_STYLES } from '../lib/storybook-styles.js';

export interface StorybookTakeActivityInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id?: string;
  /** R2-hosted locked stylized character design (from storybookCharacter). */
  character_ref_url: string;
  /** Optional voice timbre reference, carried from this character's first take. */
  voice_ref_audio_url?: string;
  /** Optional fixed seed so this character's look stays consistent across
   *  every take (derived once per story, passed to every one of their takes). */
  seed?: number;
  script: string;
  duration: 5 | 10 | 15;
  /** Setting / action / expression for this scene's shot. */
  visual_description: string;
  art_style: StorybookArtStyle;
  aspect_ratio: '9:16' | '1:1' | '16:9';
}

export interface StorybookTakeActivityResult {
  primitive_run_id: string;
  video_url: string;
  provider: 'seedance-2-0';
  credits_actual_usd: number;
  artifact_id: string;
  duration_seconds: 5 | 10 | 15;
}

const PER_DURATION_USD: Record<5 | 10 | 15, number> = {
  5: 0.6,
  10: 1.2,
  15: 1.8,
};

export function makeStorybookTakeActivity(cfg: WorkerConfig) {
  return async function storybookTake(
    activityInput: StorybookTakeActivityInput,
  ): Promise<StorybookTakeActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);

    // Retry-safety
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, actual_credits_usd, primitive_artifacts(id, url)')
      .eq('id', activityInput.primitive_run_id)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing && existing.status === 'succeeded') {
      const art = (existing.primitive_artifacts as Array<{ id: string; url: string }> | null)?.[0];
      if (!art) {
        throw new Error(
          `inconsistent state: primitive_run ${activityInput.primitive_run_id} is succeeded but has no artifact`,
        );
      }
      return {
        primitive_run_id: activityInput.primitive_run_id,
        video_url: art.url,
        provider: 'seedance-2-0',
        credits_actual_usd: Number(existing.actual_credits_usd ?? 0),
        artifact_id: art.id,
        duration_seconds: activityInput.duration,
      };
    }

    // SSRF guard
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (!activityInput.character_ref_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `character_ref_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }
    const voiceRef = activityInput.voice_ref_audio_url;
    if (voiceRef && !voiceRef.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `voice_ref_audio_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }

    // Budget — admins skip both caps, same bypass as simple_selfie.
    const estimatedUsd = PER_DURATION_USD[activityInput.duration];
    if (!(await isAdminUser(db, activityInput.user_id))) {
      if (estimatedUsd > cfg.caps.primitiveUsd) {
        throw ApplicationFailure.nonRetryable(
          `estimated $${estimatedUsd} exceeds per-primitive cap $${cfg.caps.primitiveUsd}`,
          'BUDGET_CAP_PRIMITIVE',
        );
      }
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const { data: dayRows, error: dayErr } = await db
        .from('primitive_runs')
        .select('actual_credits_usd')
        .eq('user_id', activityInput.user_id)
        .gte('created_at', since.toISOString())
        .not('actual_credits_usd', 'is', null);
      if (dayErr) throw new Error(`day-cap query failed: ${dayErr.message}`);
      const dayUsed = (dayRows ?? []).reduce((s, r) => s + Number(r.actual_credits_usd ?? 0), 0);
      if (dayUsed + estimatedUsd > cfg.caps.dayUsd) {
        throw ApplicationFailure.nonRetryable(
          `day budget exceeded: used $${dayUsed.toFixed(2)} + estimate $${estimatedUsd} > cap $${cfg.caps.dayUsd}`,
          'BUDGET_CAP_DAY',
        );
      }
    }

    const inputRecord = {
      character_ref_url: activityInput.character_ref_url,
      script: activityInput.script,
      duration: activityInput.duration,
      visual_description: activityInput.visual_description,
      art_style: activityInput.art_style,
      aspect_ratio: activityInput.aspect_ratio,
    };
    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: activityInput.primitive_run_id,
        user_id: activityInput.user_id,
        skill_run_id: activityInput.skill_run_id ?? null,
        primitive_id: 'storybook_take',
        status: 'submitted',
        input: inputRecord,
        estimated_credits_usd: estimatedUsd,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: activityInput.user_id,
      primitiveRunId: activityInput.primitive_run_id,
      primitive: 'storybook_take',
      duration: activityInput.duration,
      description: `vNext storybook_take ${activityInput.duration}s`,
    });

    try {
      const styleLanguage = STORYBOOK_ART_STYLES[activityInput.art_style];
      let prompt =
        `The character in the reference image, drawn in a ${styleLanguage}, speaks and acts in this scene: ${activityInput.visual_description.trim()}. ` +
        `Preserve the EXACT same illustrated art style as the reference image throughout the clip — do NOT shift toward photorealism, live-action, or 3D rendering at any point; keep the same linework, coloring and rendering style the whole way through. ` +
        `The character must look exactly like the reference image — identical design, colors, proportions and features, no redesign mid-clip.`;

      if (voiceRef) {
        prompt = `${prompt} The character speaks in the exact same voice, timbre and delivery style as the reference audio @Audio1 — same speaker, not a different voice.`;
      }

      const script = activityInput.script.trim();
      if (script) {
        prompt = `${prompt} The character says this line out loud, word for word exactly as written, with no additions, omissions, paraphrasing or reordering: "${script}". Speak it at a natural, unhurried pace fitting the scene's mood. If the line is short, finish speaking and then simply pause, holding the pose — do NOT add filler words, mumbling or vocal sounds to fill the remaining time; a brief pause is correct.`;
      }
      Context.current().heartbeat({ stage: 'prompt_built' });
      {
        const { error: pErr } = await db
          .from('primitive_runs')
          .update({ input: { ...inputRecord, generated_prompt: prompt } })
          .eq('id', activityInput.primitive_run_id);
        if (pErr) Context.current().heartbeat({ stage: 'prompt_persist_warning', error: pErr.message });
      }

      let videoBytes: Buffer;
      let providerTaskId: string | null = null;
      let providerVideoUrl: string | null = null;
      if (cfg.openai.simulate) {
        videoBytes = Buffer.from('SIMULATED', 'utf8');
      } else {
        const evolinkKey = process.env.EVOLINK_API_KEY?.trim() || process.env.EVOLINK_API_KEYS?.trim();
        if (!evolinkKey) {
          throw ApplicationFailure.nonRetryable(
            'EVOLINK_API_KEY not configured on primitive-worker-vnext',
            'PROVIDER_UNCONFIGURED',
          );
        }
        try {
          const result = await withHeartbeat('seedance_working', () => generateSimpleSelfieEvolink({
            prompt,
            imageUrls: [activityInput.character_ref_url],
            duration: activityInput.duration,
            aspectRatio: activityInput.aspect_ratio === '1:1' ? '1:1' : '9:16',
            generateAudio: true,
            quality: '720p',
            ...(voiceRef ? { audioUrls: [voiceRef] } : {}),
            ...(activityInput.seed != null ? { seed: activityInput.seed } : {}),
          }));
          providerTaskId = result.taskId;
          providerVideoUrl = result.videoUrl;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as any)?.status as number | undefined;
          if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 402) {
            throw ApplicationFailure.nonRetryable(`evolink ${status}: ${msg}`, `EVOLINK_${status}`);
          }
          throw err instanceof Error ? err : new Error(msg);
        }
        Context.current().heartbeat({ stage: 'provider_done', taskId: providerTaskId });
        const dlResp = await fetch(providerVideoUrl, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
        if (!dlResp.ok) throw new Error(`byteplus video download ${dlResp.status}`);
        videoBytes = Buffer.from(await dlResp.arrayBuffer());
      }
      Context.current().heartbeat({ stage: 'video_downloaded', bytes: videoBytes.byteLength });

      const { publicUrl } = await r2UploadVnext(
        cfg.r2,
        activityInput.primitive_run_id,
        'storybook-take.mp4',
        videoBytes,
        'video/mp4',
      );
      Context.current().heartbeat({ stage: 'r2_uploaded' });

      if (providerTaskId) {
        await db.from('provider_tasks').insert({
          primitive_run_id: activityInput.primitive_run_id,
          provider: 'seedance-2-0',
          external_task_id: providerTaskId,
          status: 'succeeded',
          raw_response: { provider_video_url: providerVideoUrl },
        });
      }

      const { data: artifact, error: artErr } = await db
        .from('primitive_artifacts')
        .insert({
          primitive_run_id: activityInput.primitive_run_id,
          kind: 'storybook_take_video',
          url: publicUrl,
          bytes: videoBytes.byteLength,
          mime: 'video/mp4',
          metadata: {
            provider: 'seedance-2-0',
            model: process.env.EVOLINK_SEEDANCE_MODEL || 'seedance-2.0-mini-reference-to-video',
            simulated: cfg.openai.simulate,
            aspect_ratio: activityInput.aspect_ratio,
            duration_seconds: activityInput.duration,
            art_style: activityInput.art_style,
            source_character_ref_url: activityInput.character_ref_url,
          },
        })
        .select('id')
        .single();
      if (artErr || !artifact) {
        throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);
      }
      const { error: finErr } = await db
        .from('primitive_runs')
        .update({
          status: 'succeeded',
          actual_credits_usd: estimatedUsd,
          finished_at: new Date().toISOString(),
          provider_task_id: providerTaskId,
        })
        .eq('id', activityInput.primitive_run_id);
      if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

      return {
        primitive_run_id: activityInput.primitive_run_id,
        video_url: publicUrl,
        provider: 'seedance-2-0',
        credits_actual_usd: estimatedUsd,
        artifact_id: artifact.id as string,
        duration_seconds: activityInput.duration,
      };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await refundPrimitiveCredits(db, activityInput.primitive_run_id);
      }
      throw err;
    }
  };
}
