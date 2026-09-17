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
