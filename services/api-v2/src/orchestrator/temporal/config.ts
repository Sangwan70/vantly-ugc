// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Runtime engine selector.
 * - http: legacy direct dispatch to media-worker-v2
 * - temporal: durable workflow dispatch
 */
export type OrchestratorEngine = 'http' | 'temporal';

export interface TemporalConfig {
  address: string;
  namespace: string;
  apiKey?: string;
  tlsEnabled: boolean;
  tlsServerName?: string;
  taskQueue: string;
  /** Hard ceiling for `Connection.connect()` to keep HTTP requests from hanging. */
  connectTimeoutMs: number;
  /** Hard ceiling for `workflow.start()` request itself (RPC, not workflow runtime). */
  startTimeoutMs: number;
  /** End-to-end workflow timeout set on Temporal so a workflow with no
   *  worker / failing activity is reaped server-side instead of dangling. */
  workflowExecutionTimeoutMs: number;
}

export interface ReconcilerConfig {
  enabled: boolean;
  /** How often to call `recover_stuck_jobs` from inside api-v2. */
  intervalMs: number;
  /** Threshold (minutes) for stale submitted dispatch handoffs. */
  thresholdMinutes: number;
  /** Threshold (minutes) passed to `recover_stuck_jobs(p_timeout_minutes)`. */
  processingThresholdMinutes: number;
}

export interface PrimitiveReconcilerConfig {
  enabled: boolean;
  /** How often to sweep primitive_runs from inside api-v2. */
  intervalMs: number;
  /** Threshold (minutes) a primitive_runs row may sit on submitted/running before being force-failed + refunded. */
  thresholdMinutes: number;
}

export interface SkillReconcilerConfig {
  enabled: boolean;
  /** How often to sweep skill_runs from inside api-v2. */
  intervalMs: number;
  /** Threshold (minutes) a skill_runs row may sit on submitted/running before being force-failed + refunded. */
  thresholdMinutes: number;
}

export function getOrchestratorEngine(): OrchestratorEngine {
  const raw = (process.env.ORCHESTRATOR_ENGINE ?? 'http').toLowerCase().trim();
  return raw === 'temporal' ? 'temporal' : 'http';
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getTemporalConfig(): TemporalConfig {
  const address = process.env.TEMPORAL_ADDRESS?.trim();
  const namespace = process.env.TEMPORAL_NAMESPACE?.trim();
  const taskQueue = process.env.TEMPORAL_SELFIE_TASK_QUEUE?.trim() || 'selfie-v1';
  const tlsEnabled = (process.env.TEMPORAL_TLS ?? 'true').toLowerCase() !== 'false';

  if (!address) {
    throw new Error('TEMPORAL_ADDRESS is required when ORCHESTRATOR_ENGINE=temporal');
  }
  if (!namespace) {
    throw new Error('TEMPORAL_NAMESPACE is required when ORCHESTRATOR_ENGINE=temporal');
  }

  return {
    address,
    namespace,
    apiKey: process.env.TEMPORAL_API_KEY?.trim() || undefined,
    tlsEnabled,
    tlsServerName: process.env.TEMPORAL_TLS_SERVER_NAME?.trim() || undefined,
    taskQueue,
    connectTimeoutMs: readPositiveInt('TEMPORAL_CONNECT_TIMEOUT_MS', 10_000),
    startTimeoutMs: readPositiveInt('TEMPORAL_START_TIMEOUT_MS', 10_000),
    workflowExecutionTimeoutMs: readPositiveInt(
      'TEMPORAL_WORKFLOW_EXECUTION_TIMEOUT_MS',
      20 * 60_000,
    ),
  };
}

/**
 * Reconciler defaults are deliberately conservative:
 *   - Enabled by default in the temporal engine (where stuck-submitted is
 *     the failure mode we're protecting against).
 *   - 60s interval — tighter than the pg_cron 5-min cadence so a Temporal
 *     handoff failure resolves within ~6 minutes instead of ~60.
 *   - 5-minute threshold so a normal Temporal dispatch + activity retry
 *     window (~2 minutes worst-case) is not falsely flagged.
 *   - 20-minute processing threshold so long selfie pipelines are not
 *     misclassified as stuck while still in progress.
 */
export function getReconcilerConfig(): ReconcilerConfig {
  const rawEnabled = process.env.ORCHESTRATOR_RECONCILER_ENABLED?.toLowerCase().trim();
  const defaultEnabled = getOrchestratorEngine() === 'temporal';
  const enabled = rawEnabled === undefined || rawEnabled === ''
    ? defaultEnabled
    : !(rawEnabled === 'false' || rawEnabled === '0' || rawEnabled === 'no');
  return {
    enabled,
    intervalMs: readPositiveInt('ORCHESTRATOR_RECONCILER_INTERVAL_MS', 60_000),
    thresholdMinutes: readPositiveInt('ORCHESTRATOR_RECONCILER_THRESHOLD_MINUTES', 5),
    processingThresholdMinutes: readPositiveInt(
      'ORCHESTRATOR_RECONCILER_PROCESSING_THRESHOLD_MINUTES',
      20,
    ),
  };
}

/**
 * Covers primitive_runs (vNext), a completely separate table/failure mode
 * from generation_jobs' reconciler above -- see primitive-reconciler.ts's
 * doc comment for the 2026-09-05 incident this closes.
 *
 * thresholdMinutes defaults to workflowExecutionTimeoutMs + 5 minutes: it
 * must stay ABOVE the Temporal-enforced workflow execution timeout so this
 * sweep only ever claims a run Temporal itself has already given up on,
 * never one still legitimately inside its own budget (e.g.
 * character_sheet_gpt2's up-to-3-attempts-at-6-minutes-each retry policy).
 */
export function getPrimitiveReconcilerConfig(): PrimitiveReconcilerConfig {
  const rawEnabled = process.env.ORCHESTRATOR_PRIMITIVE_RECONCILER_ENABLED?.toLowerCase().trim();
  // primitive_runs dispatch (primitive-worker-vnext) is unconditionally
  // Temporal, independent of ORCHESTRATOR_ENGINE (which only selects the
  // legacy generation_jobs path -- see getOrchestratorEngine's own doc
  // comment). Gating this safety net's default on that unrelated flag left
  // it silently off in any deployment that never set ORCHESTRATOR_ENGINE=
  // temporal, exactly the incident this reconciler exists to prevent.
  // Default to enabled; only an explicit env var should ever turn it off.
  const defaultEnabled = true;
  const enabled = rawEnabled === undefined || rawEnabled === ''
    ? defaultEnabled
    : !(rawEnabled === 'false' || rawEnabled === '0' || rawEnabled === 'no');
  const workflowExecutionTimeoutMinutes = Math.ceil(
    readPositiveInt('TEMPORAL_WORKFLOW_EXECUTION_TIMEOUT_MS', 20 * 60_000) / 60_000,
  );
  return {
    enabled,
    intervalMs: readPositiveInt('ORCHESTRATOR_PRIMITIVE_RECONCILER_INTERVAL_MS', 60_000),
    thresholdMinutes: readPositiveInt(
      'ORCHESTRATOR_PRIMITIVE_RECONCILER_THRESHOLD_MINUTES',
      workflowExecutionTimeoutMinutes + 5,
    ),
  };
}

/**
 * Covers skill_runs (composed multi-step skills: make_ugc_video,
 * broll_talking_head, make_podcast, make_storybook) -- the one durable-run
 * table with NO stuck-run safety net at all before this. primitive_runs
 * (above) and the legacy generation_jobs table (getReconcilerConfig) both
 * already have one; a composed run whose Temporal workflow dies without
 * ever reaching its own try/catch (worker crash/OOM/redeploy mid-activity)
 * previously sat on status='running' forever -- confirmed live via a
 * run-detail page stuck reporting "running" / current_step: character_sheet
 * for 10+ minutes with the underlying primitive_runs child never advancing
 * past 'submitted' either. No refund, no terminal state, just an eternal
 * spinner for the user.
 *
 * thresholdMinutes defaults to 50 (45 + 5): every composed dispatcher in
 * routes/v1/skills.ts hardcodes `workflowExecutionTimeout: 45 * 60_000`
 * for its Temporal workflow.start() call -- NOT the generic
 * TEMPORAL_WORKFLOW_EXECUTION_TIMEOUT_MS/workflowExecutionTimeoutMinutes
 * used just above for primitive_runs, which defaults to 20 and would make
 * this sweep race a still-legitimate composed run. Kept as its own env var
 * (not derived from the primitive config) so the two can be tuned
 * independently if that 45-minute constant ever changes.
 */
export function getSkillReconcilerConfig(): SkillReconcilerConfig {
  const rawEnabled = process.env.ORCHESTRATOR_SKILL_RECONCILER_ENABLED?.toLowerCase().trim();
  // Composed skill dispatch (make_ugc_video, broll_talking_head,
  // make_podcast, make_storybook) is unconditionally Temporal, independent
  // of ORCHESTRATOR_ENGINE (see getPrimitiveReconcilerConfig's identical
  // note just above -- the same flaw silently disabled this reconciler in
  // production for a week: a skill_runs row created 2026-09-10 sat at
  // status='submitted' with zero primitive_runs children, never swept,
  // because this defaulted to disabled whenever ORCHESTRATOR_ENGINE wasn't
  // explicitly 'temporal'). Default to enabled; only an explicit env var
  // should ever turn it off.
  const defaultEnabled = true;
  const enabled = rawEnabled === undefined || rawEnabled === ''
    ? defaultEnabled
    : !(rawEnabled === 'false' || rawEnabled === '0' || rawEnabled === 'no');
  return {
    enabled,
    intervalMs: readPositiveInt('ORCHESTRATOR_SKILL_RECONCILER_INTERVAL_MS', 60_000),
    thresholdMinutes: readPositiveInt('ORCHESTRATOR_SKILL_RECONCILER_THRESHOLD_MINUTES', 50),
  };
}
