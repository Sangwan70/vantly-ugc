// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import * as Sentry from '@sentry/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';

export interface ComposedSkillStateInput {
  skill_run_id: string;
  status?: 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled';
  current_step?: string;
  started_at_now?: boolean;
  finished_at_now?: boolean;
  final_output?: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
}

/**
 * Best-effort insert into skill_run_status_events (Milestone 1, item 1 --
 * the durable audit log the run-status-disagreement scoping doc asked for).
 * Never throws: a missed event is a diagnostic gap, not a reason to fail a
 * real status write. Every one of the four writer sites across this
 * codebase logs through the same shape -- see the migration's header
 * comment for the full writer list.
 */
async function recordStatusEvent(
  db: SupabaseClient,
  event: {
    skill_run_id: string;
    writer: 'worker_activity' | 'dispatch_failure' | 'cancel' | 'reconciler';
    from_status: string | null;
    to_status: string;
    applied: boolean;
    current_step?: string | null;
    error_code?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await db.from('skill_run_status_events').insert(event);
    if (error) {
      Sentry.captureMessage(`skill_run_status_events insert failed: ${error.message}`, {
        level: 'warning',
        tags: { kind: 'status_event_insert_failure', skill_run_id: event.skill_run_id },
      });
    }
  } catch (err) {
    Sentry.captureMessage(`skill_run_status_events insert threw: ${err instanceof Error ? err.message : String(err)}`, {
      level: 'warning',
      tags: { kind: 'status_event_insert_failure', skill_run_id: event.skill_run_id },
    });
  }
}

export function makeComposedSkillStateActivity(cfg: WorkerConfig) {
  return async function composedSkillState(input: ComposedSkillStateInput): Promise<void> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const patch: Record<string, unknown> = {};
    if (input.status) patch.status = input.status;
    if (input.current_step) patch.current_step = input.current_step;
    if (input.started_at_now) patch.started_at = new Date().toISOString();
    if (input.finished_at_now) patch.finished_at = new Date().toISOString();
    if (input.final_output) patch.final_output = input.final_output;
    if (input.error_code) patch.error_code = input.error_code;
    if (input.error_message) patch.error_message = input.error_message;
    if (Object.keys(patch).length === 0) return;

    // Captured for the audit event only -- best-effort, not a guard. A
    // concurrent writer can change this between the read and the update
    // below; that's fine, the update's own guard (not this read) is what
    // decides correctness.
    let priorStatus: string | null = null;
    if (input.status) {
      const { data: cur } = await db.from('skill_runs').select('status').eq('id', input.skill_run_id).maybeSingle();
      priorStatus = (cur?.status as string | undefined) ?? null;
    }

    // Guard against resurrecting a run some OTHER writer already finalized.
    // The dispatch route races (does not cancel) workflow.start() against a
    // short RPC timeout (routes/v1/skills.ts's withTimeout); if that races
    // out, markSkillRunDispatchFailed (routes/v1/skills.ts) marks the row
    // 'failed' even though the workflow actually started server-side. That
    // workflow's very first activity call here is an unconditional
    // {status:'running'} -- without this guard it silently stomps the
    // 'failed' row back to 'running', and the run appears stuck forever on
    // the run-detail page even though the jobs list already (correctly)
    // reported it failed. Skip the write entirely when the row is already
    // terminal, UNLESS this update is itself finalizing it to a terminal
    // status (a genuine late failure/success report is always allowed).
    const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled'];
    const finalizingToTerminal = input.status !== undefined && TERMINAL_STATUSES.includes(input.status);
    let query = db.from('skill_runs').update(patch).eq('id', input.skill_run_id);
    if (!finalizingToTerminal) {
      query = query.not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`);
    }
    const { error, data } = await query.select('id');
    if (error) throw new Error(`skill_runs update failed: ${error.message}`);
    const applied = finalizingToTerminal || Boolean(data && data.length > 0);

    if (input.status) {
      await recordStatusEvent(db, {
        skill_run_id: input.skill_run_id,
        writer: 'worker_activity',
        from_status: priorStatus,
        to_status: input.status,
        applied,
        current_step: input.current_step ?? null,
        error_code: input.error_code ?? null,
      });
    }

    if (!finalizingToTerminal && (!data || data.length === 0)) {
      // Guard suppressed the write -- the row was already terminal. Benign.
      return;
    }

    // #40: surface persisted run failures in Sentry. Activity throws are
    // already captured (#38), but a run RECORDED as failed (with a classified
    // error_code) doesn't throw — so we report it here, next to the crashes.
    if (input.status === 'failed') {
      const code = input.error_code ?? 'UNKNOWN';
      // Put a slice of the real error_message IN the title so the failure is
      // diagnosable from the issue list (it was only in `extra` before, showing
      // as "WORKFLOW_FAILED / no message"). Pin the fingerprint to the code +
      // step so adding the variable detail doesn't fragment grouping.
      const detail = (input.error_message ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      Sentry.captureMessage(`skill_run failed: ${code}${detail ? ` — ${detail}` : ''}`, {
        level: 'error',
        fingerprint: ['skill_run_failed', code, input.current_step ?? ''],
        tags: {
          kind: 'run_failure',
          error_code: input.error_code,
          skill_run_id: input.skill_run_id,
          current_step: input.current_step,
        },
        extra: { error_message: input.error_message },
      });
    }
  };
}
