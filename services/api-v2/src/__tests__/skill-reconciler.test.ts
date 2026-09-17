// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Skill-runs reconciler tests. Same "no mocks, no stubs" convention as
 * primitive-reconciler.test.ts / reconciler.test.ts: a real minimal fake
 * query builder/client, driven through the public exports -- exercising
 * the module's real two-table (skill_runs + primitive_runs) interaction,
 * including its own inline refund helper (kept self-contained rather than
 * imported from routes/v1/skills.ts -- see skill-reconciler.ts's doc
 * comment for why).
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reconcileStuckSkillRuns,
  startSkillReconciler,
} from '../orchestrator/skill-reconciler.js';

interface FakeSkillRun {
  id: string;
  status: string;
  updated_at: string;
  current_step?: string;
  error_code?: string;
  error_message?: string;
  finished_at?: string | null;
}

interface FakePrimitiveRun {
  id: string;
  skill_run_id: string;
  status: string;
  credits_deducted?: number;
  error_code?: string;
  error_message?: string;
  finished_at?: string | null;
}

interface FakeStatusEvent {
  id: string;
  skill_run_id: string;
  writer: string;
  from_status: string | null;
  to_status: string;
  applied: boolean;
  current_step?: string | null;
  error_code?: string | null;
}

type RefundBehavior = Record<string, string | undefined>;

class FakeTable<T extends { id: string }> {
  private filters: Array<(row: T) => boolean> = [];

  private patch: Partial<T> | null = null;

  private selecting = false;

  constructor(private rows: T[]) {}

  private field(row: T, column: keyof T): unknown {
    return (row as unknown as Record<string, unknown>)[column as string];
  }

  private inserted: T[] | null = null;

  update(patch: Partial<T>): this {
    this.patch = patch;
    return this;
  }

  insert(value: Partial<T> | Partial<T>[]): this {
    const values = Array.isArray(value) ? value : [value];
    this.inserted = values.map((v) => {
      const row = { id: crypto.randomUUID(), ...v } as T;
      this.rows.push(row);
      return row;
    });
    return this;
  }

  select(_columns: string): this {
    this.selecting = true;
    return this;
  }

  eq(column: keyof T, value: unknown): this {
    this.filters.push((row) => this.field(row, column) === value);
    return this;
  }

  in(column: keyof T, values: unknown[]): this {
    this.filters.push((row) => values.includes(this.field(row, column)));
    return this;
  }

  neq(column: keyof T, value: unknown): this {
    this.filters.push((row) => this.field(row, column) !== value);
    return this;
  }

  lt(column: keyof T, value: string): this {
    this.filters.push((row) => String(this.field(row, column) ?? '') < value);
    return this;
  }

  private async execute(): Promise<{ data: T[] | null; error: null }> {
    if (this.inserted) {
      return { data: this.inserted, error: null };
    }
    const matched = this.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.patch) {
      for (const row of matched) Object.assign(row, this.patch);
    }
    // A plain update() with no select() (the child primitive_runs
    // closeout call) has nothing meaningful to return -- real Supabase
    // would return the patched rows too, but nothing here reads `data`
    // for that call.
    return { data: this.selecting || this.patch ? matched : null, error: null };
  }

  then<TResult1 = { data: T[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function makeSupabase(
  opts: { skillRuns?: FakeSkillRun[]; primitiveRuns?: FakePrimitiveRun[]; refundBehavior?: RefundBehavior } = {},
): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  skillRuns: FakeSkillRun[];
  primitiveRuns: FakePrimitiveRun[];
  statusEvents: FakeStatusEvent[];
} {
  const skillRuns = opts.skillRuns ?? [];
  const primitiveRuns = opts.primitiveRuns ?? [];
  const statusEvents: FakeStatusEvent[] = [];
  const refundBehavior = opts.refundBehavior ?? {};
  const refunded = new Set<string>();
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'refund_credits') {
        const jobId = String(args.p_job_id ?? '');
        const forcedErr = refundBehavior[jobId];
        if (forcedErr) return { data: null, error: { message: forcedErr } };
        if (refunded.has(jobId)) {
          return { data: null, error: { message: `ALREADY_REFUNDED: credits for job ${jobId} have already been refunded` } };
        }
        refunded.add(jobId);
        return { data: { success: true }, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      if (table === 'skill_runs') return new FakeTable<FakeSkillRun>(skillRuns);
      if (table === 'primitive_runs') return new FakeTable<FakePrimitiveRun>(primitiveRuns);
      if (table === 'skill_run_status_events') return new FakeTable<FakeStatusEvent>(statusEvents);
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, rpcCalls, skillRuns, primitiveRuns, statusEvents };
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

describe('reconcileStuckSkillRuns', () => {
  it('claims a skill_run stuck past the threshold, refunds its charged children, and marks them failed', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000001';
    const childId = '00000000-0000-0000-0000-00000000c001';
    const { client, skillRuns, primitiveRuns, rpcCalls } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', current_step: 'character_sheet', updated_at: minutesAgo(60) }],
      primitiveRuns: [{ id: childId, skill_run_id: skillRunId, status: 'submitted', credits_deducted: 5 }],
    });

    const result = await reconcileStuckSkillRuns(client, 50);

    expect(result).toEqual({ claimed: 1, refunded: 1, refundFailures: 0 });
    expect(skillRuns[0].status).toBe('failed');
    expect(skillRuns[0].current_step).toBe('failed');
    expect(skillRuns[0].error_code).toBe('DISPATCH_TIMEOUT');
    expect(skillRuns[0].finished_at).toBeTruthy();
    expect(primitiveRuns[0].status).toBe('failed');
    expect(primitiveRuns[0].error_code).toBe('DISPATCH_TIMEOUT');
    expect(rpcCalls).toEqual([{ fn: 'refund_credits', args: { p_job_id: childId } }]);
  });

  it('also claims a run stuck on status=submitted, not just running', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000002';
    const { client, skillRuns } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'submitted', updated_at: minutesAgo(60) }],
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result.claimed).toBe(1);
    expect(skillRuns[0].status).toBe('failed');
  });

  it('leaves a run within the threshold window alone -- never races a still-legitimate composed workflow', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000003';
    const { client, skillRuns, rpcCalls } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(10) }],
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result).toEqual({ claimed: 0, refunded: 0, refundFailures: 0 });
    expect(skillRuns[0].status).toBe('running');
    expect(rpcCalls).toHaveLength(0);
  });

  it('never touches a succeeded, failed, or canceled skill_run', async () => {
    const { client, skillRuns } = makeSupabase({
      skillRuns: [
        { id: '00000000-0000-0000-0000-000000000010', status: 'succeeded', updated_at: minutesAgo(120) },
        { id: '00000000-0000-0000-0000-000000000011', status: 'failed', updated_at: minutesAgo(120) },
        { id: '00000000-0000-0000-0000-000000000012', status: 'canceled', updated_at: minutesAgo(120) },
      ],
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result.claimed).toBe(0);
    expect(skillRuns.map((r) => r.status)).toEqual(['succeeded', 'failed', 'canceled']);
  });

  it('never clobbers a child primitive_run that already succeeded (e.g. character_sheet finished, only the final step hung)', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000004';
    const doneChildId = '00000000-0000-0000-0000-00000000c004';
    const { client, primitiveRuns } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
      primitiveRuns: [{ id: doneChildId, skill_run_id: skillRunId, status: 'succeeded', credits_deducted: 0 }],
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result.claimed).toBe(1);
    // Guarded: still 'succeeded', not stomped to 'failed'.
    expect(primitiveRuns[0].status).toBe('succeeded');
  });

  it('treats NO_DEDUCTION_FOUND / ALREADY_REFUNDED as expected outcomes via refundSkillRunCharges, not failures', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000005';
    const childId = '00000000-0000-0000-0000-00000000c005';
    const { client, skillRuns } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
      primitiveRuns: [{ id: childId, skill_run_id: skillRunId, status: 'submitted', credits_deducted: 5 }],
      refundBehavior: { [childId]: `NO_DEDUCTION_FOUND: no debit transactions found for job ${childId}` },
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result).toEqual({ claimed: 1, refunded: 0, refundFailures: 0 });
    expect(skillRuns[0].status).toBe('failed');
  });

  it('surfaces a genuine refund error without throwing, and still leaves the run failed', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000006';
    const childId = '00000000-0000-0000-0000-00000000c006';
    const { client, skillRuns } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
      primitiveRuns: [{ id: childId, skill_run_id: skillRunId, status: 'submitted', credits_deducted: 5 }],
      refundBehavior: { [childId]: 'USER_NOT_FOUND: no credit record for user ...' },
    });
    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result.refundFailures).toBe(1);
    expect(result.error).toMatch(/USER_NOT_FOUND/);
    // Best-effort refund -- the run really did fail, so it stays claimed
    // even though the refund itself couldn't complete.
    expect(skillRuns[0].status).toBe('failed');
  });

  it('does not double-process the same row on a second pass', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000007';
    const childId = '00000000-0000-0000-0000-00000000c007';
    const { client, skillRuns, rpcCalls } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
      primitiveRuns: [{ id: childId, skill_run_id: skillRunId, status: 'submitted', credits_deducted: 5 }],
    });

    const first = await reconcileStuckSkillRuns(client, 50);
    expect(first.claimed).toBe(1);

    // Row is now status='failed', so a second sweep's WHERE status IN
    // ('submitted','running') no longer matches it.
    const second = await reconcileStuckSkillRuns(client, 50);
    expect(second.claimed).toBe(0);
    expect(rpcCalls.filter((c) => c.fn === 'refund_credits')).toHaveLength(1);
    expect(skillRuns[0].status).toBe('failed');
  });

  it('logs one skill_run_status_events row per row it claims (Milestone 1: the durable audit log)', async () => {
    const skillRunId = '00000000-0000-0000-0000-00000000e001';
    const { client, statusEvents } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
    });

    const result = await reconcileStuckSkillRuns(client, 50);
    expect(result.claimed).toBe(1);

    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toMatchObject({
      skill_run_id: skillRunId,
      writer: 'reconciler',
      to_status: 'failed',
      applied: true,
      error_code: 'DISPATCH_TIMEOUT',
    });
  });

  it('never logs an event for a row it did not claim', async () => {
    const staleId = '00000000-0000-0000-0000-00000000e002';
    const freshId = '00000000-0000-0000-0000-00000000e003';
    const { client, statusEvents } = makeSupabase({
      skillRuns: [
        { id: staleId, status: 'running', updated_at: minutesAgo(60) },
        { id: freshId, status: 'running', updated_at: minutesAgo(5) },
      ],
    });

    await reconcileStuckSkillRuns(client, 50);

    expect(statusEvents.map((e) => e.skill_run_id)).toEqual([staleId]);
  });
});

describe('startSkillReconciler', () => {
  it('no-ops when disabled and never touches the client', async () => {
    const { client, rpcCalls } = makeSupabase({});
    const handle = startSkillReconciler({
      supabase: client,
      config: { enabled: false, intervalMs: 10, thresholdMinutes: 50 },
      log: () => {},
    });
    const tick = await handle.runNow();
    expect(tick).toBeNull();
    expect(rpcCalls).toHaveLength(0);
    handle.stop();
  });

  it('runs one pass via runNow() with the configured threshold', async () => {
    const skillRunId = '00000000-0000-0000-0000-000000000020';
    const { client, skillRuns } = makeSupabase({
      skillRuns: [{ id: skillRunId, status: 'running', updated_at: minutesAgo(60) }],
    });
    const handle = startSkillReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 50 },
      log: () => {},
    });
    const tick = await handle.runNow();
    expect(tick).toMatchObject({ claimed: 1 });
    expect(skillRuns[0].status).toBe('failed');
    handle.stop();
  });

  it('honors the in-flight guard: a second runNow during a slow first tick yields null', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let started = 0;

    const client = {
      rpc: async () => ({ data: { success: true }, error: null }),
      from: () => ({
        update: () => ({
          in: () => ({
            lt: () => ({
              select: () => ({
                then: async (resolve: (v: { data: Array<{ id: string }>; error: null }) => void) => {
                  started += 1;
                  if (started === 1) await gate;
                  resolve({ data: [], error: null });
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const handle = startSkillReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 50 },
      log: () => {},
    });

    const inFlight = handle.runNow();
    const skipped = await handle.runNow();
    expect(skipped).toBeNull();

    release();
    await inFlight;
    expect(started).toBe(1);
    handle.stop();
  });

  it('captures the error path through the log channel without throwing', async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: 'should not be called' } }),
      from: () => ({
        update: () => ({
          in: () => ({
            lt: () => ({
              select: async () => ({ data: null, error: { message: 'pg: connection reset' } }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const logs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const handle = startSkillReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 50 },
      log: (msg, meta) => logs.push({ msg, meta }),
    });
    await handle.runNow();
    handle.stop();

    const errLog = logs.find((l) => l.msg === 'issues during sweep');
    expect(errLog).toBeDefined();
    expect(errLog!.meta?.error).toBe('pg: connection reset');
  });
});
