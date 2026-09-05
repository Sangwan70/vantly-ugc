// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Stuck primitive_runs reconciler.
 *
 * Why this exists (2026-09-05 incident):
 *   `character_sheet_gpt2` (and every other vNext primitive) is dispatched
 *   by pre-inserting a `primitive_runs` row with status='submitted' and
 *   THEN calling `client.workflow.start(...)` (see routes/v1/skills.ts and
 *   routes/v1/primitives.ts). If the workflow is never actually picked up
 *   and executed by any `primitive-worker-vnext` process -- worker down,
 *   crash-looping, or serving a stale/disconnected deploy (exactly the
 *   failure mode documented in docs/production-topology.md's 2026-08-02
 *   incident) -- NOTHING ever runs the workflow's own try/catch, so
 *   markPrimitiveRunFailed (activities/mark-run-failed.ts) never fires.
 *   The row sits on status='submitted' forever and the web's poll loop
 *   (GET /v1/primitives/runs/:id) reports the same unchanged body
 *   indefinitely -- a real infinite loop from the user's perspective, even
 *   though `workflow.start()` itself sets a workflowExecutionTimeout
 *   (default 20 min, see temporal/config.ts) that reaps the workflow on
 *   Temporal's side: that Temporal-side timeout is NOT observed by
 *   anything that writes back to Supabase, so the DB row never learns
 *   about it.
 *
 *   The existing reconciler.ts / recover_stuck_jobs RPC only ever covers
 *   the legacy `generation_jobs` table -- it has no knowledge of
 *   `primitive_runs` at all. This module is the missing counterpart: an
 *   in-process sweep, independent of any worker or Temporal callback,
 *   that claims primitive_runs stuck past the dispatch timeout and marks
 *   them failed + refunds credits, so a dead/stale worker degrades to
 *   "your generation failed, credits refunded" instead of an eternal
 *   spinner.
 *
 * Threshold:
 *   Deliberately set ABOVE workflowExecutionTimeoutMs (see
 *   getPrimitiveReconcilerConfig) so this never races a workflow that is
 *   still legitimately within its own Temporal-enforced budget -- this
 *   sweep only ever catches runs Temporal itself would already consider
 *   dead.
 *
 * Credits:
 *   Reuses the SAME `refund_credits(p_job_id)` RPC the legacy job
 *   reconciler and every primitive workflow's own failure path already
 *   use -- it keys purely off `credit_transactions.reference_id`, with no
 *   knowledge of which table `p_job_id` "belongs" to, so passing a
 *   primitive_runs.id is exactly how activities/character-sheet-gpt2's
 *   sibling workflows already call it. `NO_DEDUCTION_FOUND` is expected
 *   (and not an error) here specifically: a worker that never started
 *   never ran deduct_credits in the first place, so there's nothing to
 *   refund -- see routes/v1/skills.ts's comment on pre-inserting the row
 *   BEFORE the workflow (and therefore before any deduction) starts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/node';
import { getPrimitiveReconcilerConfig, type PrimitiveReconcilerConfig } from './temporal/config.js';

interface StuckPrimitiveRow {
  id: string;
}

export interface ReconcilePrimitiveRunsResult {
  claimed: number;
  refunded: number;
  alreadyRefunded: number;
  noDeductionFound: number;
  refundFailures: number;
  error?: string;
}

function thresholdToIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function refundErrorKind(message: string | undefined): 'already_refunded' | 'no_deduction' | 'other' {
  const m = message ?? '';
  if (/ALREADY_REFUNDED/i.test(m)) return 'already_refunded';
  if (/NO_DEDUCTION_FOUND/i.test(m)) return 'no_deduction';
  return 'other';
}

/**
 * One reconciliation pass over `primitive_runs`.
 *
 * 1) Claim rows stuck on status IN ('submitted','running') past the
 *    threshold into status='failed' (error_code DISPATCH_TIMEOUT) --
 *    claiming first (single UPDATE ... WHERE status IN (...) ...) means a
 *    concurrent tick (or a worker that finishes at the last possible
 *    moment) can't double-process the same row: whichever writer's UPDATE
 *    lands first wins the row, the other's WHERE no longer matches it.
 * 2) Best-effort refund each newly-claimed row. Errors are per-row and
 *    never abort the batch; ALREADY_REFUNDED and NO_DEDUCTION_FOUND are
 *    expected outcomes, not failures (see module doc comment).
 */
export async function reconcileStuckPrimitiveRuns(
  supabase: SupabaseClient,
  thresholdMinutes: number,
): Promise<ReconcilePrimitiveRunsResult> {
  const cutoff = thresholdToIso(thresholdMinutes);
  const message = `No worker completed this run within ${thresholdMinutes} minutes of dispatch -- credits refunded automatically.`;

  const { data: claimedRows, error: claimErr } = await supabase
    .from('primitive_runs')
    .update({
      status: 'failed',
      error_code: 'DISPATCH_TIMEOUT',
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .in('status', ['submitted', 'running'])
    .lt('updated_at', cutoff)
    .select('id');

  if (claimErr) {
    return { claimed: 0, refunded: 0, alreadyRefunded: 0, noDeductionFound: 0, refundFailures: 0, error: claimErr.message };
  }

  const rows = (claimedRows ?? []) as StuckPrimitiveRow[];
  let refunded = 0;
  let alreadyRefunded = 0;
  let noDeductionFound = 0;
  let refundFailures = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const { error: refundErr } = await supabase.rpc('refund_credits', { p_job_id: row.id });
    if (!refundErr) {
      refunded += 1;
      continue;
    }
    switch (refundErrorKind(refundErr.message)) {
      case 'already_refunded':
        alreadyRefunded += 1;
        break;
      case 'no_deduction':
        noDeductionFound += 1;
        break;
      default:
        refundFailures += 1;
        errors.push(`refund(${row.id}): ${refundErr.message}`);
    }
  }

  return {
    claimed: rows.length,
    refunded,
    alreadyRefunded,
    noDeductionFound,
    refundFailures,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}

export interface PrimitiveReconcilerHandle {
  stop: () => void;
  runNow: () => Promise<ReconcilePrimitiveRunsResult | null>;
}

export interface StartPrimitiveReconcilerOptions {
  supabase: SupabaseClient;
  config?: PrimitiveReconcilerConfig;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Same shape/safety properties as orchestrator/reconciler.ts's
 * startReconciler: re-entrancy guard, all errors caught and logged, timer
 * unref'd so it never blocks process shutdown. Separate handle/interval
 * from the legacy reconciler since the two sweep different tables on
 * different (non-interchangeable) thresholds.
 */
export function startPrimitiveReconciler(opts: StartPrimitiveReconcilerOptions): PrimitiveReconcilerHandle {
  const cfg = opts.config ?? getPrimitiveReconcilerConfig();
  const log = opts.log ?? ((msg, meta) =>
    meta ? console.log(`[primitive-reconciler] ${msg}`, meta) : console.log(`[primitive-reconciler] ${msg}`));

  const state = { inFlight: false, stopped: false };

  if (!cfg.enabled) {
    log('disabled (ORCHESTRATOR_PRIMITIVE_RECONCILER_ENABLED=false or engine!=temporal)');
    return { stop: () => { state.stopped = true; }, runNow: async () => null };
  }

  const tick = async (): Promise<ReconcilePrimitiveRunsResult | null> => {
    if (state.inFlight || state.stopped) return null;
    state.inFlight = true;
    try {
      const result = await reconcileStuckPrimitiveRuns(opts.supabase, cfg.thresholdMinutes);
      if (result.error) {
        log('issues during sweep', { error: result.error, thresholdMinutes: cfg.thresholdMinutes, ...result });
        // A claim/refund error here means the sweep itself is broken (bad RPC,
        // migration drift, etc) -- surface it, not just the stuck runs it was
        // trying to fix. Distinct from the happy-path alert below.
        Sentry.captureMessage(
          `primitive-reconciler: sweep encountered errors (${result.error})`,
          { level: 'error', extra: { thresholdMinutes: cfg.thresholdMinutes, ...result } },
        );
      } else if (result.claimed > 0) {
        log('recovered stuck primitive runs', { thresholdMinutes: cfg.thresholdMinutes, ...result });
        // This is the only place a stuck primitive_runs row becomes visible
        // to anyone -- previously it was silent until a user reported an
        // "infinite loop" (see 2026-09-05 incident, module doc comment
        // above). Fire a real alert so ops finds out from Sentry instead of
        // from a support ticket, and can go check whether
        // primitive-worker-vnext is actually up/polling before the NEXT
        // batch of runs hits the same fate.
        Sentry.captureMessage(
          `primitive-reconciler: recovered ${result.claimed} stuck primitive_runs past ${cfg.thresholdMinutes}min (refunded ${result.refunded}, already_refunded ${result.alreadyRefunded}, no_deduction_found ${result.noDeductionFound}, refund_failures ${result.refundFailures})`,
          { level: 'warning', extra: { thresholdMinutes: cfg.thresholdMinutes, ...result } },
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('tick threw', { error: msg });
      return { claimed: 0, refunded: 0, alreadyRefunded: 0, noDeductionFound: 0, refundFailures: 0, error: msg };
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
