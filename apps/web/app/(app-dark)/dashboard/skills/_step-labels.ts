// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Human-friendly milestone labels for a composed skill run's `current_step`
 * (GET /v1/skills/runs/:id) and its child `steps[].primitive` names --
 * shared by the run-detail timeline (dashboard/skills/runs/[id]/page.tsx)
 * and the agent chat's inline run-status chip (dashboard/agent/page.tsx),
 * so "what's actually happening right now" reads the same in both places
 * instead of one of them showing a raw backend slug like
 * "scene_2_take_1" or "storybook_character".
 *
 * make_storybook's current_step values (services/primitive-worker-vnext/
 * src/workflows/make-storybook.ts): 'pending' | 'characters' | 'scenes' |
 * `scene_${n}_take_${t}` | `voice_ref_${speaker}` | 'compose' | 'subtitles'
 * | 'done'. Other composed skills (make_ugc_video, make_podcast, ...) use
 * their own fixed step vocabularies -- prettyStepLabel's fallback (slug ->
 * Title Case) keeps this useful for those too without hardcoding every
 * skill's step names here.
 */

const EXACT_STEP_LABELS: Record<string, string> = {
  pending: 'Queued',
  characters: 'Designing your characters',
  scenes: 'Filming your scenes',
  compose: 'Putting the scenes together',
  subtitles: 'Adding subtitles',
  done: 'Done',
  // make_ugc_video's own step vocabulary -- kept here too so the agent
  // chat's inline chip (which calls prettyStepLabel for every composed
  // skill) reads naturally for that skill as well. The run-detail page's
  // RunProgress has its own more detailed weighted-progress version of
  // these same labels for make_ugc_video specifically.
  portrait: 'Generating your portrait',
  character_sheet: 'Building your character sheet',
  selfie: 'Rendering your video',
  watermark: 'Adding a watermark',
};

function titleCase(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Friendly label for a run's `current_step`. Handles make_storybook's two
 * dynamic step families (one take per scene, one voice lock per speaker)
 * specifically; falls back to a prettified version of the raw slug for
 * anything else so an unrecognized/new step name never shows as a bare
 * code identifier.
 */
export function prettyStepLabel(step: string | null | undefined): string {
  if (!step) return 'Queued';
  if (EXACT_STEP_LABELS[step]) return EXACT_STEP_LABELS[step];
  const take = step.match(/^scene_(\d+)_take_(\d+)$/);
  if (take) return `Filming scene ${take[1]} (take ${take[2]})`;
  const voice = step.match(/^voice_ref_(.+)$/);
  if (voice) return `Locking in ${titleCase(voice[1])}'s voice`;
  return titleCase(step);
}

/**
 * Friendly label for a steps[].primitive worker-activity name (the
 * run-detail Timeline section's per-row label) -- see
 * services/primitive-worker-vnext/src/activities/*.ts for the exact
 * `primitive:` string each activity writes.
 */
const PRIMITIVE_LABELS: Record<string, string> = {
  storybook_character: 'Character portrait',
  storybook_take: 'Scene clip',
  subtitles_v2: 'Subtitles',
  portrait_gpt2: 'Portrait',
  character_sheet_gpt2: 'Character sheet',
  simple_selfie: 'Video render',
  wireframe_gpt2: 'Wireframe',
  lip_sync: 'Lip sync',
};

export function prettyPrimitiveLabel(primitive: string): string {
  return PRIMITIVE_LABELS[primitive] ?? titleCase(primitive);
}

/**
 * make_storybook's fixed top-level milestones, in the order the workflow
 * visits them (make-storybook.ts). 'subtitles' only actually runs when the
 * caller opted in -- like make_ugc_video's skippable steps, a run that
 * skips it just never lights that dot up, it isn't specially detected.
 */
export const STORYBOOK_MILESTONES = ['characters', 'scenes', 'compose', 'subtitles'] as const;

/** Index into STORYBOOK_MILESTONES for a given current_step, bucketing the
 *  dynamic per-take/per-voice-lock steps into 'scenes'. -1 = not started
 *  yet (current_step is 'pending', unset, or already 'done'). */
export function storybookMilestoneIndex(step: string | null | undefined): number {
  if (!step) return -1;
  if (step === 'characters') return 0;
  if (step === 'scenes' || /^scene_\d+_take_\d+$/.test(step) || /^voice_ref_/.test(step)) return 1;
  if (step === 'compose') return 2;
  if (step === 'subtitles') return 3;
  return -1;
}
