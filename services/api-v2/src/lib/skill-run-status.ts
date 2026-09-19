// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * A primitive_runs row belonging to a skill_runs run, as needed to derive the
 * run's effective status. Kept minimal/structural (not the full DB row type)
 * so this stays trivially unit-testable.
 */
export interface SkillRunStepForStatus {
  status: string;
  primitive_id: string;
  error_code: string | null;
  error_message: string | null;
}

export interface SkillRunParentForStatus {
  status: string;
  error_code: string | null;
  error_message: string | null;
}

export interface EffectiveSkillRunStatus {
  status: string;
  error: { code: string; message: string | null } | null;
}

const TERMINAL_SKILL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

/**
 * The parent skill_runs row only reaches a terminal status once the
 * workflow's own catch handler runs, or (if that workflow died first) once
 * the skill-run reconciler sweeps it -- up to 50 minutes later, see
 * orchestrator/skill-reconciler.ts. A primitive_runs row already reporting
 * 'failed' is always FINAL for that step within this run: each step mints a
 * fixed, deterministic child id once per workflow execution, so no retry
 * ever produces a second row for the same step (verified against
 * make-storybook.ts/make-podcast.ts/broll-talking-head.ts/
 * make-ugc-video.ts's makeChildRunId usage). Every composed skill here runs
 * its steps strictly sequentially, so a failed step always dooms the whole
 * run eventually. Report that truth to the client the moment we see it
 * rather than leaving the run on "running"/"submitted" for however long it
 * takes the workflow or reconciler to catch up -- this is the fix for the
 * run-status-disagreement bug (jobs list showing a child step's real status
 * while the run-detail page spun on the stale parent status).
 */
export function deriveEffectiveSkillRunStatus(
  run: SkillRunParentForStatus,
  stepRows: SkillRunStepForStatus[],
): EffectiveSkillRunStatus {
  const failedStep = TERMINAL_SKILL_STATUSES.has(run.status)
    ? undefined
    : stepRows.find((s) => s.status === 'failed');
  const status = failedStep ? 'failed' : run.status;
  const error = run.error_code
    ? { code: run.error_code, message: run.error_message }
    : failedStep
      ? {
          code: failedStep.error_code ?? 'STEP_FAILED',
          message: failedStep.error_message || `Step "${failedStep.primitive_id}" failed.`,
        }
      : null;
  return { status, error };
}
// ── "Is this actually frozen?" ──────────────────────────────────────────
//
// Separate from deriveEffectiveSkillRunStatus above (which only ever
// reports a status the backend already believes, sooner). This instead
// flags a run that's LIKELY stuck even while every row involved still
// says "submitted"/"running" -- the exact situation a 2026-09-19
// production incident sat in for 30+ minutes: current_step stayed
// "characters" and both storybook_character primitive_runs stayed
// "submitted" the entire time, well past how long that step ever
// legitimately takes, with nothing in the data model saying so.
//
// Deliberately informational only -- this never kills a run or touches
// credits (that stays the sole job of skill-reconciler.ts /
// primitive-reconciler.ts, whose 25/50-minute thresholds are sized to
// sit safely above Temporal's own workflowExecutionTimeout so they never
// race a workflow that's still legitimately within its own budget). A
// run can keep working and self-heal via Temporal's own retries after
// this flag has already fired -- it's a "this looks unusually slow, want
// to check?" signal for the user, surfaced fast, not a verdict.
//
// Postgres has no per-activity heartbeat timestamp visible to this
// service (that lives inside Temporal), so the only progress signal
// available here is "when did the current step, or any step, last
// start/finish". A step sitting idle past its own generous expected
// duration -- not a single global timeout -- is what gets flagged, so a
// naturally-longer step (a scene's video take) doesn't fire as fast as a
// naturally-quick one (a character portrait) firing this same signal.
export interface RunHealthStepInput {
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunHealth {
  stalled: boolean;
  stalled_for_seconds: number | null;
}

const TERMINAL_FOR_HEALTH = new Set(['succeeded', 'failed', 'canceled']);

/**
 * Generous expected-duration ceiling (seconds) for a composed skill's
 * current_step, used only to decide "is this taking unusually long", never
 * to compute a percentage. Bucketed by step-name PREFIX because
 * make_storybook's per-take/per-voice-lock steps are dynamic
 * (`scene_2_take_1`, `voice_ref_luna`) -- see _step-labels.ts on the
 * frontend, which buckets the same way for display.
 */
function expectedStepSeconds(skill: string | null | undefined, step: string | null): number {
  if (!step || step === 'pending') return 120;
  if (skill === 'make_storybook') {
    if (step === 'characters') return 180; // a single gpt-image-2 call per character, in parallel
    if (step === 'scenes' || step.startsWith('scene_') || step.startsWith('voice_ref_')) return 480; // a Seedance take
    if (step === 'compose') return 300;
    if (step === 'subtitles') return 300;
    return 300;
  }
  if (skill === 'make_ugc_video' || skill === 'make_ugc') {
    if (step === 'portrait' || step === 'character_sheet') return 120;
    if (step === 'selfie') return 600; // the seedance render, the real long pole
    return 180;
  }
  // Unknown skill/step: stay generous rather than false-flag something
  // this function has no real basis to judge.
  return 360;
}

/**
 * `run.started_at` is when the WHOLE run began, not when the current step
 * began -- there's no per-step "entered this step at" column today, so the
 * best available proxy for "how long has the current step actually been
 * idle" is the latest started_at/finished_at seen across every step row,
 * falling back to the run's own started_at when there are no step rows
 * yet (still queued/dispatching).
 */
export function computeRunHealth(
  run: { status: string; started_at: string | null },
  skill: string | null | undefined,
  currentStep: string | null,
  stepRows: RunHealthStepInput[],
  nowMs: number = Date.now(),
): RunHealth {
  if (TERMINAL_FOR_HEALTH.has(run.status)) return { stalled: false, stalled_for_seconds: null };
  let latestMs: number | null = run.started_at ? new Date(run.started_at).getTime() : null;
  for (const s of stepRows) {
    const t = s.finished_at ?? s.started_at;
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (latestMs === null || ms > latestMs) latestMs = ms;
  }
  if (latestMs === null || !Number.isFinite(latestMs)) return { stalled: false, stalled_for_seconds: null };
  const idleSec = Math.max(0, (nowMs - latestMs) / 1000);
  const ceilingSec = expectedStepSeconds(skill, currentStep);
  if (idleSec < ceilingSec) return { stalled: false, stalled_for_seconds: null };
  return { stalled: true, stalled_for_seconds: Math.round(idleSec) };
}
