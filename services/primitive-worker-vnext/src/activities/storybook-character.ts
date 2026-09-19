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

    // Heartbeat across the artifact-insert -> finalize-status-update tail too,
    // not just the provider call above: these are normally sub-second, but a
    // Supabase stall here (connection-pool exhaustion, a slow query) with zero
    // heartbeats for heartbeatTimeout (5min for this activity, see
    // workflows/make-storybook.ts's videoRetry) reads to Temporal exactly like
    // a dead activity. Temporal then retries on a fresh attempt while THIS
    // attempt's writes are still in flight (Node doesn't cancel them), and
    // when they land afterwards the run looks like the DB "lost" a write that
    // actually succeeded, just late and unheartbeated -- the write path never
    // had a bug, it just went quiet at the one moment quiet gets misread as
    // dead. See withHeartbeat's own doc comment for the identical failure
    // mode this codebase already fixed once for the provider-call phase.
    const artifactId = await withHeartbeat('finalizing_writes', async () => {
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
      return artifact.id as string;
    });

    // Auto-save this design as a reusable character, mirroring
    // character-sheet-gpt2.ts's autoSaveCharacter (make_character_sheet) --
    // storybook characters previously only ever lived inside their
    // skill_run/primitive_artifacts rows, so they never appeared in
    // /dashboard/actors ("My Characters") or any skill's saved-character
    // picker, even though the design itself is exactly as reusable as one
    // from make_character_sheet. Unlike that sibling activity (which only
    // gets a generic description, hence its 'Untitled character' fallback),
    // storybook already carries a real `name` input (e.g. "Winny"), so this
    // saves under that name directly. BEST-EFFORT: the character is already
    // generated + finalized above, so a failure here must never fail the
    // activity. Idempotent (dedup by user_id+character_sheet_url) — a
    // Temporal retry re-enters at the top-of-function early return before
    // ever reaching here again.
    try {
      await autoSaveCharacter(db, {
        userId: activityInput.user_id,
        name: activityInput.name.trim() || 'Untitled character',
        characterSheetUrl: publicUrl,
      });
    } catch (err) {
      Context.current().heartbeat({
        stage: 'autosave_character_warning',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      primitive_run_id: activityInput.primitive_run_id,
      character_url: publicUrl,
      provider: 'gpt-image-2',
      artifact_id: artifactId,
    };
  };
}

/**
 * Idempotently save a generated storybook character design as a reusable
 * user character. Deduped by (user_id, character_sheet_url) -- mirrors
 * character-sheet-gpt2.ts's helper of the same name (not shared as a common
 * module since each activity's input shape differs slightly; kept in sync
 * by hand -- see that file if this one needs a matching update).
 */
async function autoSaveCharacter(
  db: ReturnType<typeof getDb>,
  p: { userId: string; name: string; characterSheetUrl: string },
): Promise<void> {
  const { data: existing } = await db
    .from('user_characters')
    .select('id')
    .eq('user_id', p.userId)
    .eq('character_sheet_url', p.characterSheetUrl)
    .maybeSingle();
  if (existing) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await db.from('user_characters').insert({
      user_id: p.userId,
      name: p.name.slice(0, 80),
      source_kind: 'description',
      public_id: makePublicId(),
      character_sheet_url: p.characterSheetUrl,
      portrait_url: p.characterSheetUrl,
      thumbnail_url: p.characterSheetUrl,
    });
    if (!error) return;
    if (error.code === '23505' && attempt < 2) continue; // public_id collision -> re-mint
    throw new Error(`user_characters insert failed: ${error.message}`);
  }
}

/** char_ + 10 Crockford base32 chars (no I/L/O/U). Mirrors character-sheet-gpt2.ts's
 *  helper of the same name; the unique index on user_characters.public_id
 *  catches any collision. */
function makePublicId(): string {
  const ALPHA = '0123456789ABCDEFGHJKLMNPQRSTVWXYZ';
  let s = 'char_';
  for (let i = 0; i < 10; i += 1) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

function makeStubPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
}
