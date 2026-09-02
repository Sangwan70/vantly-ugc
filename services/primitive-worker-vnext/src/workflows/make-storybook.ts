// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Composed skill workflow: make_storybook.
 *
 * A cast of 1-4 characters acts out an ordered sequence of scenes, each
 * character TALKING on-screen (native Seedance voice) in ONE consistent
 * illustrated art style — never a static illustration with a voiceover:
 *
 *   1. storybookCharacter — ONE locked stylized design PER CHARACTER
 *      (parallel — no shared master/room to anchor from, unlike podcast's
 *      two-shot; each character is designed independently, free gpt-image-2).
 *   2. per scene          — chunk the speaking character's line into <=15s
 *      takes (same word-count/duration-bucket planner make_broll_talking_head
 *      uses — see @vantly-ugc/schema's take-planner.ts) and animate each
 *      chunk with storybookTake against that character's locked design.
 *      Every take of the SAME character reuses their design + voice_ref +
 *      seed, so a character stays visually and vocally consistent across
 *      every scene they appear in, exactly as make_podcast locks each actor.
 *   3. compose            — HARD-cut the ordered takes together on the
 *      chosen aspect ratio (a cross-dissolve would ghost one character's
 *      design into the next).
 *   4. subtitles           — optional burned captions.
 *
 * Each primitive Activity writes its own primitive_runs row tied to the
 * parent skill_run_id; a terminal failure refunds every charged child
 * (idempotent — free character-design steps refund as no-ops).
 */

import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import { chunkScript, fitDuration } from '@vantly-ugc/schema';
import type { StorybookArtStyle } from '@vantly-ugc/schema';
import type { PrimitiveActivities } from '../activities/index.js';
import type { StorybookCharacterActivityResult } from '../activities/storybook-character.js';
import type { StorybookTakeActivityInput, StorybookTakeActivityResult } from '../activities/storybook-take.js';
import type { ExtractAudioActivityResult } from '../activities/extract-audio.js';
import type { ComposeBrollOverlayInput, ComposeBrollOverlayResult } from '../activities/compose-broll-overlay.js';
import type { SubtitlesActivityInput, SubtitlesActivityResult } from '../activities/subtitles.js';

export interface StorybookCharacterInput {
  name: string;
  /** R2-hosted photo/character reference (optional — most characters have none). */
  ref_url?: string;
  /** Physical look + personality, when there is no photo reference. */
  description?: string;
}

export interface StorybookSceneInput {
  /** Must match a `name` in `characters`. */
  speaker: string;
  line: string;
  visual_description: string;
}

export interface MakeStorybookWorkflowInput {
  skill_run_id: string;
  user_id: string;
  title?: string;
  characters: StorybookCharacterInput[];
  art_style: StorybookArtStyle;
  style_notes?: string;
  scenes: StorybookSceneInput[];
  aspect_ratio: '9:16' | '1:1' | '16:9';
  subtitles?: boolean;
  subtitles_style?: 'hormozi' | 'tiktok' | 'minimal';
}

export interface MakeStorybookWorkflowResult {
  skill_run_id: string;
  video_url: string;
  duration_seconds: number;
  credits_actual_usd: number;
}

const NON_RETRYABLE = [
  'INVALID_INPUT', 'BUDGET_CAP_PRIMITIVE', 'BUDGET_CAP_DAY',
  'REFERENCE_FETCH_FAILED', 'REFERENCE_NOT_IMAGE', 'REFERENCE_URL_NOT_ALLOWED',
  'REFERENCE_NOT_VIDEO', 'PROVIDER_UNCONFIGURED', 'INSUFFICIENT_CREDITS',
  'OPENAI_400', 'OPENAI_401', 'OPENAI_403', 'OPENAI_404', 'OPENAI_413', 'OPENAI_415', 'OPENAI_422', 'OPENAI_451',
  'EVOLINK_400', 'EVOLINK_401', 'EVOLINK_403', 'EVOLINK_404', 'EVOLINK_413', 'EVOLINK_415', 'EVOLINK_422', 'EVOLINK_451',
  'TRANSCRIBE_EMPTY',
];

const videoRetry = {
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '5 minutes',
  retry: { initialInterval: '10s', maximumInterval: '2m', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: NON_RETRYABLE },
} as const;
const utilRetry = {
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '90 seconds',
  retry: { initialInterval: '5s', maximumInterval: '60s', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: NON_RETRYABLE },
} as const;

const { storybookCharacter } = proxyActivities<PrimitiveActivities>(videoRetry);
const { storybookTake } = proxyActivities<PrimitiveActivities>(videoRetry);
const { composeBrollOverlay } = proxyActivities<PrimitiveActivities>(videoRetry);
const { extractAudio } = proxyActivities<PrimitiveActivities>(utilRetry);
const { subtitles } = proxyActivities<PrimitiveActivities>(utilRetry);
const { composedSkillState } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});
const { refundCredits, markPrimitiveRunFailed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

interface PlannedTake {
  sceneIndex: number;
  speaker: string;
  script: string;
  duration: 5 | 10 | 15;
  visual_description: string;
}

/** Flatten scenes into ordered <=15s takes; long scene lines chunk into several,
 *  same planner make_broll_talking_head uses (@vantly-ugc/schema's chunkScript). */
export function planStorybookTakes(scenes: StorybookSceneInput[]): {
  takes: PlannedTake[];
  perSpeaker: Record<string, number>;
} {
  const takes: PlannedTake[] = [];
  const perSpeaker: Record<string, number> = {};
  scenes.forEach((scene, sceneIndex) => {
    for (const chunk of chunkScript(scene.line)) {
      takes.push({
        sceneIndex,
        speaker: scene.speaker,
        script: chunk,
        duration: fitDuration(chunk),
        visual_description: scene.visual_description,
      });
      perSpeaker[scene.speaker] = (perSpeaker[scene.speaker] ?? 0) + 1;
    }
  });
  return { takes, perSpeaker };
}

export async function makeStorybookWorkflow(
  input: MakeStorybookWorkflowInput,
): Promise<MakeStorybookWorkflowResult> {
  const skillRunId = input.skill_run_id;
  // Every child run id we mint, so the catch can refund exactly what was
  // charged (character-design steps refund as no-ops; only paid takes matter).
  const refundIds: string[] = [];
  const mint = (step: string): string => {
    const id = makeChildRunId(skillRunId, step);
    refundIds.push(id);
    return id;
  };

  await composedSkillState({
    skill_run_id: skillRunId,
    status: 'running',
    current_step: 'characters',
    started_at_now: true,
  });

  try {
    if (input.characters.length === 0) {
      throw ApplicationFailure.nonRetryable('storybook needs at least one character', 'INVALID_INPUT');
    }
    const names = new Set(input.characters.map((c) => c.name.trim()));
    for (const scene of input.scenes) {
      if (!names.has(scene.speaker.trim())) {
        throw ApplicationFailure.nonRetryable(
          `scene speaker "${scene.speaker}" does not match any character name`,
          'INVALID_INPUT',
        );
      }
    }

    // ── 1. Design every character's locked look, in parallel ─────────────────
    const designed = await Promise.all(
      input.characters.map(async (c) => {
        const result: StorybookCharacterActivityResult = await storybookCharacter({
          primitive_run_id: mint(`char_${slugify(c.name)}`),
          user_id: input.user_id,
          skill_run_id: skillRunId,
          name: c.name,
          ref_url: c.ref_url,
          description: c.description,
          art_style: input.art_style,
          style_notes: input.style_notes,
        });
        return { name: c.name.trim(), character_url: result.character_url };
      }),
    );
    const characterUrl: Record<string, string> = {};
    for (const d of designed) characterUrl[d.name] = d.character_url;

    // ── 2. Plan + render every scene's takes, in order ────────────────────────
    await composedSkillState({ skill_run_id: skillRunId, current_step: 'scenes' });
    const { takes, perSpeaker } = planStorybookTakes(input.scenes);
    if (takes.length === 0) {
      throw ApplicationFailure.nonRetryable('storybook produced no takes', 'INVALID_INPUT');
    }

    const seed: Record<string, number> = {};
    for (const name of Object.keys(perSpeaker)) seed[name] = seedFromString(`${skillRunId}:${name}`);
    // Per-character voice lock: minted from each character's FIRST take, reused after.
    const voiceRef: Record<string, string | undefined> = {};

    const clipUrls: string[] = [];
    let totalCredits = 0;

    for (let i = 0; i < takes.length; i += 1) {
      const take = takes[i];
      const speaker = take.speaker.trim();
      await composedSkillState({ skill_run_id: skillRunId, current_step: `scene_${take.sceneIndex + 1}_take_${i + 1}` });

      const takeInput: StorybookTakeActivityInput = {
        primitive_run_id: mint(`take_${i}`),
        user_id: input.user_id,
        skill_run_id: skillRunId,
        character_ref_url: characterUrl[speaker],
        voice_ref_audio_url: voiceRef[speaker],
        seed: seed[speaker],
        script: take.script,
        duration: take.duration,
        visual_description: take.visual_description,
        art_style: input.art_style,
        aspect_ratio: input.aspect_ratio,
      };
      const r: StorybookTakeActivityResult = await storybookTake(takeInput);
      clipUrls.push(r.video_url);
      totalCredits += r.credits_actual_usd;

      // Bootstrap this character's voice from their first take (only worth it
      // when they have more than one take across the whole story).
      if (voiceRef[speaker] === undefined && (perSpeaker[speaker] ?? 0) > 1) {
        await composedSkillState({ skill_run_id: skillRunId, current_step: `voice_ref_${slugify(speaker)}` });
        const extracted: ExtractAudioActivityResult = await extractAudio({
          primitive_run_id: mint(`voiceref_${slugify(speaker)}`),
          user_id: input.user_id,
          skill_run_id: skillRunId,
          video_url: r.video_url,
          max_seconds: 15,
        });
        voiceRef[speaker] = extracted.audio_url;
      }
    }

    // ── 3. Hard-cut the ordered takes onto the chosen canvas ──────────────────
    await composedSkillState({ skill_run_id: skillRunId, current_step: 'compose' });
    const composeInput: ComposeBrollOverlayInput = {
      primitive_run_id: mint('compose'),
      user_id: input.user_id,
      skill_run_id: skillRunId,
      clip_urls: clipUrls,
      aspect_ratio: input.aspect_ratio,
      overlay_size: 'large',
      overlay_position: 'bottom',
      hard_cut: true,
    };
    const composed: ComposeBrollOverlayResult = await composeBrollOverlay(composeInput);

    // ── 4. Optional captions ───────────────────────────────────────────────────
    let finalUrl = composed.video_url;
    if (input.subtitles) {
      await composedSkillState({ skill_run_id: skillRunId, current_step: 'subtitles' });
      const subsInput: SubtitlesActivityInput = {
        primitive_run_id: mint('subs'),
        user_id: input.user_id,
        skill_run_id: skillRunId,
        input: {
          video_url: composed.video_url,
          transcript: input.scenes.map((s) => s.line).join(' '),
          style: input.subtitles_style ?? 'hormozi',
          aspect_ratio: input.aspect_ratio === '16:9' ? '9:16' : input.aspect_ratio,
        },
      };
      const subs: SubtitlesActivityResult = await subtitles(subsInput);
      totalCredits += subs.credits_actual_usd;
      finalUrl = subs.video_url;
    }

    const finalOutput = {
      video_url: finalUrl,
      duration_seconds: composed.duration_seconds,
      credits_actual_usd: totalCredits,
    };
    await composedSkillState({
      skill_run_id: skillRunId,
      status: 'succeeded',
      current_step: 'done',
      finished_at_now: true,
      final_output: finalOutput,
    });
    return { skill_run_id: skillRunId, ...finalOutput };
  } catch (err) {
    const errorCode = err instanceof ApplicationFailure ? (err.type ?? 'WORKFLOW_FAILED') : 'WORKFLOW_FAILED';
    const errorMessage = err instanceof Error ? err.message.slice(0, 500) : String(err);
    for (const rid of refundIds) {
      await refundCredits({ primitive_run_id: rid });
      await markPrimitiveRunFailed({ primitive_run_id: rid, error_code: errorCode, error_message: errorMessage });
    }
    await composedSkillState({
      skill_run_id: skillRunId,
      status: 'failed',
      finished_at_now: true,
      error_code: errorCode,
      error_message: errorMessage,
    });
    throw err;
  }
}

// ── deterministic helpers (safe inside the workflow isolate: no crypto/Date/random) ──

/** FNV-1a 32-bit hash. Deterministic + side-effect-free. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic non-negative 31-bit seed from a string (never 0). */
function seedFromString(s: string): number {
  return (fnv1a(s) % 2147483646) + 1;
}

/** Deterministic child primitive_run_id from skill_run_id + step (unique per step). */
function makeChildRunId(skillRunId: string, step: string): string {
  const suffix = (fnv1a(step).toString(16).padStart(8, '0') + '0000').slice(0, 12);
  const base = skillRunId.replace(/[^a-f0-9-]/gi, '').toLowerCase();
  return base.slice(0, base.length - 12) + suffix;
}

/** Lowercase, alnum-only slug for use inside a step name / run-id suffix. */
function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'x';
}
