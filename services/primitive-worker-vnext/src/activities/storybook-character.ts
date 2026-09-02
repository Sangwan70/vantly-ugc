// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * make_storybook step 1 — ONE character's locked stylized design.
 *
 * Storybook characters are usually designed FRESH from a text description (a
 * talking fox, a friendly dragon) rather than from a photo — the common case
 * this activity optimizes for. When a `ref_url` IS supplied (a saved
 * character's photo, or any image), it is used as a multi-reference edit
 * input so the design takes cues from it, but the prompt still explicitly
 * steers toward the chosen illustrated `art_style` rather than preserving
 * photorealism — a stylized character sheet, not a portrait.
 *
 * Free (like the character sheet inside make_ugc_video / the podcast master
 * scene) — the paid step is the per-scene animated take.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import type { StorybookArtStyle } from '@vantly-ugc/schema';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { generateImageWithFallback, classifyOpenAIError } from '../client/openai.js';
import { r2UploadVnext } from '../client/r2.js';
import { sanitizeImagePrompt } from '../lib/sanitize-prompt.js';
import { withHeartbeat } from '../lib/heartbeat.js';
import { STORYBOOK_ART_STYLES } from '../lib/storybook-styles.js';
import { fetchImageRef } from './podcast-scene.js';

export interface StorybookCharacterActivityInput {
  primitive_run_id: string;
  user_id: string;
  skill_run_id?: string;
  name: string;
  /** Optional R2-hosted photo/character reference to design from. */
  ref_url?: string;
  /** Physical look + personality, when there is no photo reference. */
  description?: string;
  art_style: StorybookArtStyle;
  style_notes?: string;
}

export interface StorybookCharacterActivityResult {
  primitive_run_id: string;
  character_url: string;
  provider: 'gpt-image-2';
  artifact_id: string;
}

export function makeStorybookCharacterActivity(cfg: WorkerConfig) {
  return async function storybookCharacter(
    activityInput: StorybookCharacterActivityInput,
  ): Promise<StorybookCharacterActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);

    // Retry-safety: a completed run early-returns its banked design.
    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, primitive_artifacts(id, url)')
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
        character_url: art.url,
        provider: 'gpt-image-2',
        artifact_id: art.id,
      };
    }

    // SSRF guard on the optional reference.
    const allowedPrefix = cfg.r2.publicUrl.replace(/\/+$/, '') + '/';
    if (activityInput.ref_url && !activityInput.ref_url.startsWith(allowedPrefix)) {
      throw ApplicationFailure.nonRetryable(
        `ref_url must be hosted on the configured R2 public URL (${allowedPrefix})`,
        'REFERENCE_URL_NOT_ALLOWED',
      );
    }
    if (!activityInput.ref_url && !activityInput.description?.trim()) {
      throw ApplicationFailure.nonRetryable(
        'storybook character needs either ref_url or description',
        'INVALID_INPUT',
      );
    }

    // Record the run BEFORE the provider call so a poll finds it (free step).
    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: activityInput.primitive_run_id,
        user_id: activityInput.user_id,
        skill_run_id: activityInput.skill_run_id ?? null,
        primitive_id: 'storybook_character',
        status: 'submitted',
        input: {
          name: activityInput.name,
          ref_url: activityInput.ref_url ?? null,
          description: activityInput.description ?? null,
          art_style: activityInput.art_style,
        },
        estimated_credits_usd: 0,
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    const styleLanguage = STORYBOOK_ART_STYLES[activityInput.art_style];
    const styleNotes = activityInput.style_notes?.trim();

    let refBytes: Buffer | undefined;
    let promptText: string;
    if (activityInput.ref_url) {
      refBytes = await fetchImageRef(activityInput.ref_url, 'ref_url');
      Context.current().heartbeat({ stage: 'reference_fetched' });
      promptText =
        `Redesign the character in the reference image as a ${styleLanguage}. ` +
        `Take cues from the reference's general look (hair/fur color, build, notable features) but render it FULLY in the new illustrated style — ` +
        `do NOT preserve photorealistic skin, lighting or camera detail; this is a character DESIGN, not a photo edit. ` +
        `Character name: "${activityInput.name}". ` +
        (activityInput.description?.trim() ? `Additional description: ${activityInput.description.trim()}. ` : '') +
        (styleNotes ? `Extra style guidance: ${styleNotes}. ` : '') +
        `Full-body standing character turnaround pose, plain light neutral background, centered, no text, no watermark, no logos.`;
    } else {
      promptText =
        `Design an original ${styleLanguage}. ` +
        `Character name: "${activityInput.name}". Description: ${activityInput.description!.trim()}. ` +
        (styleNotes ? `Extra style guidance: ${styleNotes}. ` : '') +
        `Full-body standing character turnaround pose, plain light neutral background, centered, friendly and expressive, no text, no watermark, no logos.`;
    }
    const prompt = sanitizeImagePrompt(promptText);

    let bytes: Buffer;
    if (cfg.openai.simulate) {
      bytes = makeStubPng();
    } else {
      try {
        const out = await withHeartbeat('provider_working', () =>
          generateImageWithFallback(cfg.openai, {
            model: cfg.openai.imageModel,
            prompt,
            ...(refBytes ? { referencePngs: [refBytes] } : {}),
            size: '1024x1024',
          }),
        );
        bytes = out.bytes;
      } catch (err) {
        const classified = classifyOpenAIError(err);
        if (classified.retryable) throw err instanceof Error ? err : new Error(String(err));
        throw ApplicationFailure.nonRetryable(classified.message, classified.code);
      }
    }
    Context.current().heartbeat({ stage: 'provider_done', bytes: bytes.byteLength });

    const { publicUrl } = await r2UploadVnext(
      cfg.r2,
      activityInput.primitive_run_id,
      'storybook-character.png',
      bytes,
      'image/png',
    );
    Context.current().heartbeat({ stage: 'r2_uploaded' });

    const { data: artifact, error: artErr } = await db
      .from('primitive_artifacts')
      .insert({
        primitive_run_id: activityInput.primitive_run_id,
        kind: 'storybook_character',
        url: publicUrl,
        bytes: bytes.byteLength,
        mime: 'image/png',
        metadata: {
          provider: 'gpt-image-2',
          model: cfg.openai.imageModel,
          simulated: cfg.openai.simulate,
          name: activityInput.name,
          art_style: activityInput.art_style,
          ref_url: activityInput.ref_url ?? null,
        },
      })
      .select('id')
      .single();
    if (artErr || !artifact) {
      throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);
    }
    const { error: finErr } = await db
      .from('primitive_runs')
      .update({ status: 'succeeded', actual_credits_usd: 0, finished_at: new Date().toISOString() })
      .eq('id', activityInput.primitive_run_id);
    if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);

    return {
      primitive_run_id: activityInput.primitive_run_id,
      character_url: publicUrl,
      provider: 'gpt-image-2',
      artifact_id: artifact.id as string,
    };
  };
}

function makeStubPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
}
