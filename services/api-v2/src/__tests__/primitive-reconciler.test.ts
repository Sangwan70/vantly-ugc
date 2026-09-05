// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Primitive-runs reconciler tests. Same "no mocks, no stubs" convention as
 * reconciler.test.ts: a real minimal fake query builder/client, driven
 * through the public exports.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reconcileStuckPrimitiveRuns,
  startPrimitiveReconciler,
} from '../orchestrator/primitive-reconciler.js';

interface FakeRun {
  id: string;
  status: string;
  updated_at: string;
  error_code?: string;
  error_message?: string;
  finished_at?: string | null;
}

type RefundBehavior = Record<string, string | undefined>;

class FakeQueryBuilder {
  private filters: Array<(run: FakeRun) => boolean> = [];

  private patch: Partial<FakeRun> | null = null;

  private selected = false;

  constructor(private runs: FakeRun[]) {}

  update(patch: Partial<FakeRun>): this {
    this.patch = patch;
    return this;
  }

  select(_columns: string): this {
    this.selected = true;
    return this;
  }

  in(column: keyof FakeRun, values: unknown[]): this {
    this.filters.push((run) => values.includes((run as unknown as Record<string, unknown>)[column]));
    return this;
  }

  lt(column: keyof FakeRun, value: string): this {
    this.filters.push((run) => String((run as unknown as Record<string, unknown>)[column] ?? '') < value);
    return this;
  }

  private async execute(): Promise<{ data: Array<{ id: string }>; error: null }> {
    const rows = this.runs.filter((run) => this.filters.every((f) => f(run)));
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    return { data: this.selected ? rows.map((r) => ({ id: r.id })) : [], error: null };
  }

  then<TResult1 = { data: Array<{ id: string }>; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Array<{ id: string }>; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function makeSupabase(
  opts: { runs?: FakeRun[]; refundBehavior?: RefundBehavior } = {},
): { client: SupabaseClient; calls: Array<{ fn: string; args: Record<string, unknown> }>; runs: FakeRun[] } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const runs = opts.runs ?? [];
  const refundBehavior = opts.refundBehavior ?? {};
  const refunded = new Set<string>();

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
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
      if (table !== 'primitive_runs') throw new Error(`unexpected table ${table}`);
      return new FakeQueryBuilder(runs);
    },
  } as unknown as SupabaseClient;
  return { client, calls, runs };
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

describe('reconcileStuckPrimitiveRuns', () => {
  it('claims a submitted run stuck past the threshold and refunds it', async () => {
    const staleId = '00000000-0000-0000-0000-000000000001';
    const { client, calls, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(30) }],
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);

    expect(result).toEqual({ claimed: 1, refunded: 1, alreadyRefunded: 0, noDeductionFound: 0, refundFailures: 0 });
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error_code).toBe('DISPATCH_TIMEOUT');
    expect(runs[0].finished_at).toBeTruthy();
    expect(calls).toEqual([{ fn: 'refund_credits', args: { p_job_id: staleId } }]);
  });

  it('also claims a run stuck on status=running, not just submitted', async () => {
    const staleId = '00000000-0000-0000-0000-000000000002';
    const { client, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'running', updated_at: minutesAgo(30) }],
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result.claimed).toBe(1);
    expect(runs[0].status).toBe('failed');
  });

  it('leaves a run within the threshold window alone -- never races a still-legitimate run', async () => {
    const freshId = '00000000-0000-0000-0000-000000000003';
    const { client, runs, calls } = makeSupabase({
      runs: [{ id: freshId, status: 'submitted', updated_at: minutesAgo(3) }],
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result).toEqual({ claimed: 0, refunded: 0, alreadyRefunded: 0, noDeductionFound: 0, refundFailures: 0 });
    expect(runs[0].status).toBe('submitted');
    expect(calls).toHaveLength(0);
  });

  it('never touches a succeeded, failed, or canceled run', async () => {
    const { client, runs } = makeSupabase({
      runs: [
        { id: '00000000-0000-0000-0000-000000000010', status: 'succeeded', updated_at: minutesAgo(60) },
        { id: '00000000-0000-0000-0000-000000000011', status: 'failed', updated_at: minutesAgo(60) },
        { id: '00000000-0000-0000-0000-000000000012', status: 'canceled', updated_at: minutesAgo(60) },
      ],
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result.claimed).toBe(0);
    expect(runs.map((r) => r.status)).toEqual(['succeeded', 'failed', 'canceled']);
  });

  it('treats NO_DEDUCTION_FOUND as an expected outcome, not a failure (worker never started deduct_credits)', async () => {
    const staleId = '00000000-0000-0000-0000-000000000004';
    const { client, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(30) }],
      refundBehavior: { [staleId]: `NO_DEDUCTION_FOUND: no debit transactions found for job ${staleId}` },
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result).toEqual({ claimed: 1, refunded: 0, alreadyRefunded: 0, noDeductionFound: 1, refundFailures: 0 });
    // Still marked failed even though there was nothing to refund.
    expect(runs[0].status).toBe('failed');
  });

  it('treats ALREADY_REFUNDED as an expected outcome (idempotent re-run)', async () => {
    const staleId = '00000000-0000-0000-0000-000000000005';
    const { client } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(30) }],
      refundBehavior: { [staleId]: `ALREADY_REFUNDED: credits for job ${staleId} have already been refunded` },
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result).toEqual({ claimed: 1, refunded: 0, alreadyRefunded: 1, noDeductionFound: 0, refundFailures: 0 });
  });

  it('surfaces a genuine refund error without throwing, and still leaves the row failed', async () => {
    const staleId = '00000000-0000-0000-0000-000000000006';
    const { client, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(30) }],
      refundBehavior: { [staleId]: 'USER_NOT_FOUND: no credit record for user ...' },
    });

    const result = await reconcileStuckPrimitiveRuns(client, 25);
    expect(result.refundFailures).toBe(1);
    expect(result.error).toMatch(/USER_NOT_FOUND/);
    // The row is still claimed/failed -- refund is best-effort, not a
    // precondition for marking the run terminal (the run really did fail).
    expect(runs[0].status).toBe('failed');
  });

  it('does not double-process the same row on a second pass', async () => {
    const staleId = '00000000-0000-0000-0000-000000000007';
    const { client, calls, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(30) }],
    });

    const first = await reconcileStuckPrimitiveRuns(client, 25);
    expect(first.claimed).toBe(1);

    // Row is now status='failed', so a second sweep's WHERE status IN
    // ('submitted','running') no longer matches it.
    const second = await reconcileStuckPrimitiveRuns(client, 25);
    expect(second.claimed).toBe(0);
    expect(calls.filter((c) => c.fn === 'refund_credits')).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
  });
});

describe('startPrimitiveReconciler', () => {
  it('no-ops when disabled and never touches the client', async () => {
    const { client, calls } = makeSupabase({ runs: [] });
    const handle = startPrimitiveReconciler({
      supabase: client,
      config: { enabled: false, intervalMs: 10, thresholdMinutes: 25 },
      log: () => {},
    });
    const tick = await handle.runNow();
    expect(tick).toBeNull();
    expect(calls).toHaveLength(0);
    handle.stop();
  });

  it('runs one pass via runNow() with the configured threshold', async () => {
    const staleId = '00000000-0000-0000-0000-000000000020';
    const { client, runs } = makeSupabase({
      runs: [{ id: staleId, status: 'submitted', updated_at: minutesAgo(40) }],
    });
    const handle = startPrimitiveReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 25 },
      log: () => {},
    });
    const tick = await handle.runNow();
    expect(tick).toMatchObject({ claimed: 1, refunded: 1 });
    expect(runs[0].status).toBe('failed');
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

    const handle = startPrimitiveReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 25 },
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
    const handle = startPrimitiveReconciler({
      supabase: client,
      config: { enabled: true, intervalMs: 60_000, thresholdMinutes: 25 },
      log: (msg, meta) => logs.push({ msg, meta }),
    });
    await handle.runNow();
    handle.stop();

    const errLog = logs.find((l) => l.msg === 'issues during sweep');
    expect(errLog).toBeDefined();
    expect(errLog!.meta?.error).toBe('pg: connection reset');
  });
});
