// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Additional admin-dashboard panels surfacing data /api/admin/metrics
 * already computes (queue health, worker health, per-hour throughput,
 * status/latency/error breakdowns, cost) that page.tsx previously fetched
 * but never rendered beyond the `growth` block — plus a new signups-by-day
 * trend from /api/admin/dashboard/signups-by-day.
 *
 * Pure addition: this file is only ever appended into page.tsx below the
 * existing panels, never replacing anything there.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const MUTED = 'rgba(255,255,255,0.45)';
const LABEL = 'rgba(255,255,255,0.4)';
const TEXT = '#E9E9F0';

export interface DashboardMetrics {
  queue: { depth: number; pgmq_depth: number; oldest_age_seconds: number; newest_age_seconds: number };
  status_counts_24h: Record<string, number>;
  latency_by_generator_24h: Record<string, { p50: number | null; p95: number | null; p99: number | null; n: number }>;
  error_rate_by_generator_1h: Record<string, { failed: number; total: number; rate: number }>;
  top_errors_24h: { code: string; count: number }[];
  jobs_per_hour_24h: { hour: string; total: number; completed: number; failed: number }[];
  worker_health: unknown;
  cost: { provider_cost_usd_24h: number; provider_cost_usd_7d: number; credits_completed_24h: number; credits_completed_7d: number };
  counts: { jobs_24h: number; jobs_7d: number };
}

export interface SignupsByDay {
  days: { date: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#34D399',
  failed: '#F87171',
  generating: '#FBBF24',
  submitted: '#A78BFA',
  pending: 'rgba(255,255,255,0.35)',
};
const statusColor = (s: string) => STATUS_COLORS[s] ?? 'rgba(167,139,250,0.5)';

function PanelHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: LABEL }}>{title}</div>
      {sub ? <div className="text-[11px]" style={{ color: MUTED }}>{sub}</div> : null}
    </div>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div className="text-xl font-semibold" style={{ color: valueColor ?? TEXT }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: LABEL }}>{label}</div>
    </div>
  );
}

function isWorkerHealthy(h: unknown): { ok: boolean; message: string } {
  if (h && typeof h === 'object' && 'error' in h) {
    const err = (h as { error?: unknown }).error;
    return { ok: false, message: typeof err === 'string' ? err : 'Worker health check failed' };
  }
  return { ok: true, message: 'Healthy' };
}

/** Operations summary: queue depth, worker health, throughput, cost. */
function OperationsPanel({ metrics }: { metrics: DashboardMetrics }) {
  const worker = isWorkerHealthy(metrics.worker_health);
  const [showWorkerDetail, setShowWorkerDetail] = useState(false);
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Operations" sub="live" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Queue depth" value={metrics.queue.depth.toLocaleString()} />
        <Stat label="PGMQ depth" value={metrics.queue.pgmq_depth.toLocaleString()} />
        <Stat label="Jobs (24h)" value={metrics.counts.jobs_24h.toLocaleString()} />
        <Stat label="Jobs (7d)" value={metrics.counts.jobs_7d.toLocaleString()} />
        <Stat label="Provider cost (24h)" value={`$${metrics.cost.provider_cost_usd_24h.toFixed(2)}`} />
        <Stat label="Provider cost (7d)" value={`$${metrics.cost.provider_cost_usd_7d.toFixed(2)}`} />
        <Stat label="Credits used (24h)" value={metrics.cost.credits_completed_24h.toLocaleString()} />
        <Stat label="Credits used (7d)" value={metrics.cost.credits_completed_7d.toLocaleString()} />
      </div>
      <button
        type="button"
        onClick={() => setShowWorkerDetail((v) => !v)}
        className="mt-3 flex w-full items-center gap-1.5 border-t pt-2 text-left text-[12px]"
        style={{ borderColor: 'rgba(255,255,255,0.06)', color: MUTED }}
      >
        {showWorkerDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: worker.ok ? '#34D399' : '#F87171' }} />
        Worker: {worker.ok ? 'healthy' : worker.message}
      </button>
      {showWorkerDetail ? (
        <pre className="mt-2 overflow-x-auto rounded-lg px-3 py-2 text-[11px]" style={{ background: '#0F1015', color: 'rgba(255,255,255,0.6)' }}>
          {JSON.stringify(metrics.worker_health, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** Vertical bar-chart row, values scaled to the tallest bar in the series. */
function BarRow({
  bars,
  colorFor,
  labelFor,
  titleFor,
}: {
  bars: { key: string; value: number }[];
  colorFor: (key: string) => string;
  labelFor?: (key: string) => string;
  titleFor: (key: string, value: number) => string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="mt-3 flex h-24 items-end gap-[2px]">
      {bars.map((b) => (
        <div key={b.key} className="group relative flex-1" title={titleFor(b.key, b.value)}>
          <div
            className="w-full rounded-[2px] transition-opacity group-hover:opacity-80"
            style={{ height: `${Math.max(2, (b.value / max) * 96)}px`, background: colorFor(b.key) }}
          />
          {labelFor ? null : null}
        </div>
      ))}
    </div>
  );
}

/** Jobs per hour, last 24h — stacked height not needed, just total throughput with a completed/failed tint. */
function ThroughputPanel({ metrics }: { metrics: DashboardMetrics }) {
  const bars = metrics.jobs_per_hour_24h.map((h) => ({
    key: h.hour,
    value: h.total,
    completed: h.completed,
    failed: h.failed,
  }));
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Jobs per hour" sub="last 24h" />
      <div className="mt-3 flex h-24 items-end gap-[2px]">
        {bars.map((b) => {
          const total = Math.max(2, (b.value / max) * 96);
          const failedH = b.value ? (b.failed / b.value) * total : 0;
          const hourLabel = new Date(b.key).toLocaleTimeString([], { hour: 'numeric' });
          return (
            <div
              key={b.key}
              className="group relative flex-1"
              title={`${hourLabel}: ${b.value} total, ${b.completed} completed, ${b.failed} failed`}
            >
              <div className="w-full overflow-hidden rounded-[2px]" style={{ height: total, background: 'rgba(167,139,250,0.5)' }}>
                {failedH > 0 ? <div className="w-full" style={{ height: failedH, background: '#F87171' }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: MUTED }}>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: 'rgba(167,139,250,0.5)' }} />completed / other</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: '#F87171' }} />failed</span>
      </div>
    </div>
  );
}

/** New signups per day, last N days. */
function SignupsTrendPanel({ signups }: { signups: SignupsByDay }) {
  const bars = signups.days.map((d) => ({ key: d.date, value: d.count }));
  const total = bars.reduce((s, b) => s + b.value, 0);
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="New signups" sub={`${total.toLocaleString()} in ${bars.length}d`} />
      <BarRow
        bars={bars}
        colorFor={() => '#34D399'}
        titleFor={(key, value) => `${key}: ${value} signup${value === 1 ? '' : 's'}`}
      />
    </div>
  );
}

/** Status breakdown, last 24h — stacked bar + legend, mirroring the onboarding funnel's stacked-bar style. */
function StatusBreakdownPanel({ metrics }: { metrics: DashboardMetrics }) {
  const entries = Object.entries(metrics.status_counts_24h).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Job status" sub="last 24h" />
      {entries.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>No jobs in the last 24h.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {entries.map(([status, n]) => (
              <div key={status} style={{ width: `${(n / total) * 100}%`, background: statusColor(status) }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
            {entries.map(([status, n]) => (
              <span key={status} className="inline-flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
                <span className="h-2 w-2 rounded-sm" style={{ background: statusColor(status) }} />
                {status} <span style={{ color: TEXT }}>{n.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Latency (p50/p95/p99) per generator, last 24h completed jobs. */
function LatencyTable({ metrics }: { metrics: DashboardMetrics }) {
  const rows = Object.entries(metrics.latency_by_generator_24h).sort((a, b) => b[1].n - a[1].n);
  const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}s`);
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Latency by generator" sub="last 24h, completed" />
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>No completed jobs in the last 24h.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="grid grid-cols-5 gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider" style={{ color: LABEL }}>
            <span className="col-span-2">Generator</span><span>p50</span><span>p95</span><span>p99</span>
          </div>
          {rows.map(([op, lat]) => (
            <div key={op} className="grid grid-cols-5 gap-2 px-3 py-1.5 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)' }}>
              <span className="col-span-2 truncate" style={{ color: TEXT }}>{op} <span style={{ color: MUTED }}>({lat.n})</span></span>
              <span>{fmt(lat.p50)}</span><span>{fmt(lat.p95)}</span><span>{fmt(lat.p99)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Error rate per generator, last 1h. */
function ErrorRateTable({ metrics }: { metrics: DashboardMetrics }) {
  const rows = Object.entries(metrics.error_rate_by_generator_1h).sort((a, b) => b[1].rate - a[1].rate);
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Error rate by generator" sub="last 1h" />
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>No jobs in the last hour.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map(([op, r]) => (
            <div key={op} className="flex items-center gap-3 text-[12px]">
              <span className="w-32 shrink-0 truncate" style={{ color: TEXT }}>{op}</span>
              <div className="relative h-4 flex-1 overflow-hidden rounded-md" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.min(100, r.rate * 100)}%`, background: r.rate >= 0.1 ? 'rgba(248,113,113,0.6)' : 'rgba(167,139,250,0.4)' }} />
              </div>
              <span className="w-28 shrink-0 text-right" style={{ color: r.rate >= 0.1 ? '#F87171' : MUTED }}>
                {r.failed}/{r.total} ({(r.rate * 100).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Top error codes, last 24h. */
function TopErrorsTable({ metrics }: { metrics: DashboardMetrics }) {
  const rows = metrics.top_errors_24h;
  return (
    <div className="rounded-2xl px-4 py-4" style={CARD}>
      <PanelHeader title="Top errors" sub="last 24h" />
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: MUTED }}>No errors in the last 24h.</p>
      ) : (
        <div className="mt-3 space-y-1">
          {rows.map((e) => (
            <div key={e.code} className="flex items-center justify-between text-[12px]">
              <span className="truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{e.code}</span>
              <span style={{ color: TEXT }}>{e.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OpsPanels({ metrics, signups }: { metrics: DashboardMetrics | null; signups: SignupsByDay | null }) {
  if (!metrics) return null;
  return (
    <>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2"><OperationsPanel metrics={metrics} /></div>
        <StatusBreakdownPanel metrics={metrics} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ThroughputPanel metrics={metrics} />
        {signups ? <SignupsTrendPanel signups={signups} /> : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <LatencyTable metrics={metrics} />
        <ErrorRateTable metrics={metrics} />
        <TopErrorsTable metrics={metrics} />
      </div>
    </>
  );
}
