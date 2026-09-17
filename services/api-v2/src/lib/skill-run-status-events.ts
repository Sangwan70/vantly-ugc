// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Durable audit log for skill_runs.status writes (Milestone 1, item 1 of
 * the Video Generation Flow audit's Reliability & Trust Hardening phase).
 *
 * Three api-v2 write sites (markSkillRunDispatchFailed, the cancel handler,
 * and skill-reconciler.ts) plus primitive-worker-vnext's composed-state.ts
 * activity all write skill_runs.status independently, each with its own
 * guard reasoning. d8f7d46 root-caused and fixed the one specific race this
 * was built in response to (a resurrected workflow stomping an
 * already-'failed' row back to 'running', run 4ca002c6) -- this table is
 * the general trail so the *next* disagreement is a query, not another live
 * HAR investigation. See supabase/migrations/20260917190000_skill_run_status_events.sql.
 *
 * Best-effort: never throws. A missed event is a diagnostic gap, not a
 * reason to fail the real status write it's logging.
 */
export interface SkillRunStatusEvent {
  skill_run_id: string;
  writer: 'worker_activity' | 'dispatch_failure' | 'cancel' | 'reconciler';
  from_status: string | null;
  to_status: string;
  applied: boolean;
  current_step?: string | null;
  error_code?: string | null;
}

export async function recordSkillRunStatusEvent(
  supabase: SupabaseClient,
  event: SkillRunStatusEvent,
): Promise<void> {
  try {
    const { error } = await supabase.from('skill_run_status_events').insert(event);
    if (error) {
      console.error(`[skill-run-status-events] insert failed for ${event.skill_run_id}: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[skill-run-status-events] insert threw for ${event.skill_run_id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
