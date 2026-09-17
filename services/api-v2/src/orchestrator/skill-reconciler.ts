// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Stuck skill_runs reconciler.
 *
 * Why this exists:
 *   A composed skill (make_ugc_video, broll_talking_head, make_podcast,
 *   make_storybook) is dispatched by pre-inserting a `skill_runs` row
 *   (status='submitted') and THEN calling `client.workflow.start(...)` (see
 *   routes/v1/skills.ts). If the Temporal workflow is started but then dies
 *   without ever reaching its own top-level try/catch -- the worker process
 *   crashes, gets OOM-killed, or is redeployed mid-activity -- nothing ever
 *   calls composedSkillState({status:'failed', ...}), and the row sits on
 *   status='running' (or 'submitted', if it died before the first step even
 *   reported in) forever. The web's poll loop (GET /v1/skills/runs/:id)
 *   then reports the same unchanged "running" body indefinitely -- a real
 *   infinite spinner from the user's perspective, with the credits for any
 *   already-charged step never refunded.
 *
 *   Confirmed live: a run-detail page reporting status "running",
 *   current_step "character_sheet" for 10+ minutes with the underlying
 *   primitive_runs child never advancing past 'submitted' either.
 *
 *   primitive-reconciler.ts already closes this exact gap for standalone
 *   primitive_runs, and orchestrator/reconciler.ts closes it for the legacy
 *   generation_jobs table -- this was the one durable-run table with no
 *   safety net at all. This module is that missing counterpart for
 *   skill_runs.
 *
 * Threshold:
 *   Deliberately set ABOVE every composed dispatcher's Temporal
 *   workflowExecutionTimeout (see getSkillReconcilerConfig) so this never
 *   races a workflow that is still legitimately within its own budget --
 *   this sweep only ever catches runs Temporal itself would already
 *   consider dead.
 *
 * Credits + child rows:
 *   Refunds every charged primitive_runs child the same way
 *   routes/v1/skills.ts's refundSkillRunCharges does for
 *   `POST /v1/skills/runs/:id/cancel` (same RPC, same idempotent
 *   ALREADY_REFUNDED / NO_DEDUCTION_FOUND handling) -- kept as an inline,
 *   self-contained copy here rather than importing that route module,
 *   because routes/v1/skills.ts pulls in server.ts's full app bootstrap
 *   (env var assertions, Express setup, Sentry, ...) at import time, which
 *   is exactly the kind of heavy, side-effecting dependency a small
 *   reconciler sweep -- and its unit tests -- should not carry. Also
 *   closes out any still-open child primitive_runs rows (guarded against
 *   clobbering one that already reached 'succeeded', same as
 *   primitive-worker-vnext's own markPrimitiveRunFailed activity) so the
 *   run-detail timeline shows a real terminal step instead of a phantom
 *   "submitted" one under a parent that's now failed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { getSkillReconcilerConfig, type SkillReconcilerConfig } from './temporal/config.js';
import { recordSkillRunStatusEvent } from '../lib/skill-run-status-events.js';

interface StuckSkillRow {
  id: string;
}

/**
 * Refund every credit charged under a skill run -- an inline copy of
 * routes/v1/skills.ts's refundSkillRunCharges (see the module doc comment
 * above for why this isn't just imported from there). Keep the two in
 * sync if the refund semantics ever change.
 */
async function refundSkillRunCharges(
  supabase: SupabaseClient,
  skillRunId: string,
): Promise<{ charged: number; refunded: number }> {
  const { data: rows, error } = await supabase
    .from('primitive_runs')
    .select('id, credits_deducted')
    .eq('skill_run_id', skillRunId);
  if (error) throw new Error(`primitive_runs lookup failed: ${error.message}`);

  const charged = (rows ?? []).filter((r) => Number(r.credits_deducted ?? 0) > 0);
  let refunded = 0;

  for (const row of charged) {
    const { error: rpcErr } = await supabase.rpc('refund_credits', { p_job_id: row.id });
    if (!rpcErr) {
      refunded += 1;
      continue;
    }
    if (/ALREADY_REFUNDED|NO_DEDUCTION_FOUND/i.test(rpcErr.message)) continue;
    throw new Error(`refund_credits failed for primitive_run ${row.id}: ${rpcErr.message}`);
  }

  return { charged: charged.length, refunded };
}

export interface ReconcileSkillRunsResult {
  claimed: number;
  refunded: number;
  refundFailures: number;
  error?: string;
}

function thresholdToIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * One reconciliation pass over `skill_runs`.
 *
 * 1) Claim rows stuck on status IN ('submitted','running') past the
 *    threshold into status='failed' (error_code DISPATCH_TIMEOUT) -- a
 *    single UPDATE ... WHERE status IN (...) ... means a concurrent tick
 *    can't double-process the same row: whichever writer's UPDATE lands
 *    first wins the row, the other's WHERE no longer matches it. Same
 *    property `composed-state.ts`'s guard relies on for its own writes, so
 *    a workflow that finishes at the last possible moment can't race this.
 * 2) Best-effort close out any still-open child primitive_runs.
 * 3) Best-effort refund each newly-claimed run's charges.
 */
export async function reconcileStuckSkillRuns(
  supabase: SupabaseClient,
  thresholdMinutes: number,
): Promise<ReconcileSkillRunsResult> {
  const cutoff = thresholdToIso(thresholdMinutes);
  const message = `No worker completed this run within ${thresholdMinutes} minutes of dispatch -- credits refunded automatically.`;

  const { data: claimedRows, error: claimErr } = await supabase
    .from('skill_runs')
    .update({
      status: 'failed',
      current_step: 'failed',
      error_code: 'DISPATCH_TIMEOUT',
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .in('status', ['submitted', 'running'])
    .lt('updated_at', cutoff)
    .select('id');

  if (claimErr) {
    return { claimed: 0, refunded: 0, refundFailures: 0, error: claimErr.message };
  }

  const rows = (claimedRows ?? []) as StuckSkillRow[];
  if (rows.length === 0) {
    return { claimed: 0, refunded: 0, refundFailures: 0 };
  }

  // One audit event per row this tick actually claimed. Best-effort: logged
  // after the claim succeeds, never allowed to affect the refund pass below.
  await Promise.all(
    rows.map((row) =>
      recordSkillRunStatusEvent(supabase, {
        skill_run_id: row.id,
        writer: 'reconciler',
        // The claim filter (status IN ('submitted','running')) guarantees
        // what it WAS, but not which of the two for this specific row --
        // logging that precisely would need a second read racing the same
        // window the atomic UPDATE above exists to close. Left null rather
        // than guessed; every other writer's events for this run give the
        // full picture around it.
        from_status: null,
        to_status: 'failed',
        applied: true,
        current_step: 'failed',
        error_code: 'DISPATCH_TIMEOUT',
      }),
    ),
  );

  const errors: string[] = [];

  // Best-effort: never clobber a step that already succeeded, mirroring
  // primitive-worker-vnext's own markPrimitiveRunFailed activity. A
  // failure here is secondary display data, not the money -- it doesn't
  // block the refund pass below.
  const claimedIds = rows.map((r) => r.id);
  const { error: childErr } = await supabase
    .from('primitive_runs')
    .update({
      status: 'failed',
      error_code: 'DISPATCH_TIMEOUT',
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .in('skill_run_id', claimedIds)
    .neq('status', 'succeeded');
  if (childErr) {
    errors.push(`child primitive_runs update failed: ${childErr.message}`);
  }

  let refunded = 0;
  let refundFailures = 0;

  for (const row of rows) {
    try {
      const r = await refundSkillRunCharges(supabase, row.id);
      refunded += r.refunded;
    } catch (err) {
      refundFailures += 1;
      errors.push(`refund(${row.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    claimed: rows.length,
    refunded,
    refundFailures,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}

export interface SkillReconcilerHandle {
  stop: () => void;
  runNow: () => Promise<ReconcileSkillRunsResult | null>;
}

export interface StartSkillReconcilerOptions {
  supabase: SupabaseClient;
  config?: SkillReconcilerConfig;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Same shape/safety properties as primitive-reconciler.ts's
 * startPrimitiveReconciler: re-entrancy guard, all errors caught and
 * logged, timer unref'd so it never blocks process shutdown. Separate
 * handle/interval from the other two reconcilers since all three sweep
 * different tables on different (non-interchangeable) thresholds.
 */
export function startSkillReconciler(opts: StartSkillReconcilerOptions): SkillReconcilerHandle {
  const cfg = opts.config ?? getSkillReconcilerConfig();
  const log = opts.log ?? ((msg, meta) =>
    meta ? console.log(`[skill-reconciler] ${msg}`, meta) : console.log(`[skill-reconciler] ${msg}`));

  const state = { inFlight: false, stopped: false };

  if (!cfg.enabled) {
    log('disabled (ORCHESTRATOR_SKILL_RECONCILER_ENABLED=false or engine!=temporal)');
    return { stop: () => { state.stopped = true; }, runNow: async () => null };
  }

  const tick = async (): Promise<ReconcileSkillRunsResult | null> => {
    if (state.inFlight || state.stopped) return null;
    state.inFlight = true;
    try {
      const result = await reconcileStuckSkillRuns(opts.supabase, cfg.thresholdMinutes);
      if (result.error) {
        log('issues during sweep', { error: result.error, thresholdMinutes: cfg.thresholdMinutes, ...result });
        Sentry.captureMessage(
          `skill-reconciler: sweep encountered errors (${result.error})`,
          { level: 'error', extra: { thresholdMinutes: cfg.thresholdMinutes, ...result } },
        );
      } else if (result.claimed > 0) {
        log('recovered stuck skill runs', { thresholdMinutes: cfg.thresholdMinutes, ...result });
        // This is the only place a stuck skill_runs row becomes visible to
        // anyone -- previously it was silent until a user reported an
        // eternal "running" spinner. Fire a real alert so ops finds out
        // from Sentry instead of from a support ticket, and can go check
        // whether primitive-worker-vnext is actually up before the NEXT
        // batch of composed runs hits the same fate.
        Sentry.captureMessage(
          `skill-reconciler: recovered ${result.claimed} stuck skill_runs past ${cfg.thresholdMinutes}min (refunded ${result.refunded}, refund_failures ${result.refundFailures})`,
          { level: 'warning', extra: { thresholdMinutes: cfg.thresholdMinutes, ...result } },
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('tick threw', { error: msg });
      return { claimed: 0, refunded: 0, refundFailures: 0, error: msg };
    } finally {
      state.inFlight = false;
    }
  };

  log('started', { intervalMs: cfg.intervalMs, thresholdMinutes: cfg.thresholdMinutes });
  const handle = setInterval(() => { void tick(); }, cfg.intervalMs);
  if (typeof handle.unref === 'function') handle.unref();

  return {
    stop: () => {
      state.stopped = true;
      clearInterval(handle);
      log('stopped');
    },
    runNow: tick,
  };
}
