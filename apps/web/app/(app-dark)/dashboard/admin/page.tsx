// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin — internal admin panel (dark theme), gated to the
 * allowlist in lib/admin-allowlist.ts (you + Nevo). Replaces the old
 * light-themed /admin. Shows all subscribed users, their creations (legacy
 * generation_jobs + vNext primitive_runs, merged server-side), stats, and
 * lets an admin grant credits / change plan / inspect a user (read-only).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, Search, Coins, ExternalLink, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { OpsPanels, type DashboardMetrics, type SignupsByDay } from './_ops-panels';

interface Job {
  id: string;
  model_slug: string | null;
  operation: string | null;
  status: string | null;
  prompt: string | null;
  output_media_url: string | null;
  credit_cost: number | null;
  created_at: string | null;
}
interface AdminUser {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  subscription: { plan_slug: string; status: string; current_period_end: string | null } | null;
  credits: { monthly_credits_remaining: number; purchased_balance: number } | null;
  jobs: Job[];
  computed: { months_subscribed: number; total_credits_used: number; last_creation_at: string | null; total_creations: number };
}

interface Growth {
  signups: { total: number; last_7d: number; last_24h: number };
  onboarding: {
    onboarded: number;
    in_progress: number;
    not_started: number;
    completion_rate: number;
    by_step: Record<string, number>;
    funnel: { step: string; reached: number; pct_of_start: number; drop_from_prev: number; drop_pct: number }[];
    funnel_started: number;
  };
  subscriptions: {
    active_total: number;
    by_plan: Record<string, number>;
    conversion_rate: number;
    conversion_rate_of_onboarded: number;
  };
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const PLANS = ['starter', 'creator', 'pro_plus'];

export default function AdminPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [signups, setSignups] = useState<SignupsByDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'credits_used' | 'creations'>('recent');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Users moderation (block/delete): default view stays subscription-only
  // (today's behavior, and the common case) -- "Show all" opts into
  // ?all=1 so free signups who never subscribed become visible and
  // therefore moderatable, per the admin-replication plan's identified gap.
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      setSelected(new Set());
      // Users list + growth funnel + ops metrics + signups trend load in
      // parallel; a metrics/signups hiccup must not block the user table,
      // so those failures are swallowed (their panels just hide).
      const usersUrl = showAll ? '/api/admin/users?all=1' : '/api/admin/users';
      const [r, m, s] = await Promise.all([
        fetch(usersUrl, { credentials: 'include' }),
        fetch('/api/admin/metrics', { credentials: 'include' }).catch(() => null),
        fetch('/api/admin/dashboard/signups-by-day?days=30', { credentials: 'include' }).catch(() => null),
      ]);
      if (r.status === 403) { setError('Not authorized.'); setUsers([]); return; }
      if (!r.ok) { setError(`users ${r.status}`); setUsers([]); return; }
      const j = await r.json();
      setUsers(j.users ?? []);
      if (m && m.ok) {
        const mj = await m.json().catch(() => null);
        setGrowth(mj?.growth ?? null);
        setMetrics(mj ?? null);
      }
      if (s && s.ok) {
        const sj = await s.json().catch(() => null);
        setSignups(sj ?? null);
      }
    } catch (e) { setError((e as Error).message); setUsers([]); }
  }, [showAll]);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const stats = useMemo(() => {
    const u = users ?? [];
    return {
      users: u.length,
      creations: u.reduce((s, x) => s + (x.computed?.total_creations ?? 0), 0),
      creditsUsed: u.reduce((s, x) => s + (x.computed?.total_credits_used ?? 0), 0),
      active: u.filter((x) => x.subscription?.status === 'active').length,
    };
  }, [users]);

  const filtered = useMemo(() => {
    let u = [...(users ?? [])];
    const needle = q.trim().toLowerCase();
    if (needle) u = u.filter((x) => (x.email ?? '').toLowerCase().includes(needle) || (x.display_name ?? '').toLowerCase().includes(needle));
    u.sort((a, b) => {
      if (sort === 'credits_used') return (b.computed?.total_credits_used ?? 0) - (a.computed?.total_credits_used ?? 0);
      if (sort === 'creations') return (b.computed?.total_creations ?? 0) - (a.computed?.total_creations ?? 0);
      return (b.computed?.last_creation_at ?? '').localeCompare(a.computed?.last_creation_at ?? '');
    });
    return u;
  }, [users, q, sort]);

  async function giveCredits(u: AdminUser) {
    const raw = window.prompt(`Give credits to ${u.email}\nAmount (1–100000):`, '1000');
    if (!raw) return;
    const amount = parseInt(raw, 10);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) { alert('Amount must be 1–100000'); return; }
    setBusy(u.id);
    try {
      const r = await fetch('/api/admin/add-credits', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: u.id, amount }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setBusy(null); }
  }

  async function grantPlan(u: AdminUser, plan_slug: string) {
    if (!plan_slug) return;
    setBusy(u.id);
    try {
      const r = await fetch('/api/admin/grant-subscription', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: u.id, plan_slug }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setBusy(null); }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length && filtered.length > 0) ? new Set() : new Set(filtered.map((u) => u.id)));
  }

  async function blockUser(u: AdminUser, blocked: boolean) {
    const reason = blocked ? (window.prompt(`Block ${u.email ?? u.id}\nReason (optional, shown to no one but admins):`, '') ?? undefined) : undefined;
    if (blocked && reason === undefined) return; // prompt cancelled
    setBusy(u.id);
    try {
      const r = await fetch('/api/admin/block-user', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: u.id, blocked, reason: reason || undefined }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setBusy(null); }
  }

  async function bulkBlock(blocked: boolean) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(blocked
      ? `Block ${ids.length} user${ids.length === 1 ? '' : 's'}? They'll be signed out immediately and unable to log back in until unblocked.`
      : `Unblock ${ids.length} user${ids.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    try {
      const failures: string[] = [];
      for (const id of ids) {
        const r = await fetch('/api/admin/block-user', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: id, blocked }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); failures.push(`${id}: ${j.error ?? r.status}`); }
      }
      if (failures.length) alert(`${ids.length - failures.length} succeeded, ${failures.length} failed:\n${failures.join('\n')}`);
      await load();
    } finally { setBulkBusy(false); }
  }

  async function confirmBulkDelete() {
    const ids = confirmDeleteIds;
    if (!ids || ids.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch('/api/admin/bulk-delete-users', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_ids: ids }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setConfirmDeleteIds(null);
      if (j.error_count > 0) {
        const details = (j.errors ?? []).map((e: { user_id: string; error: string }) => `${e.user_id}: ${e.error}`).join('\n');
        alert(`Deleted ${j.deleted_count}, ${j.error_count} failed:\n${details}`);
      }
      await load();
    } finally { setBulkBusy(false); }
  }

  function exportCsv() {
    const rows = filtered.filter((u) => selected.size === 0 || selected.has(u.id));
    const header = ['email', 'display_name', 'plan_slug', 'status', 'is_blocked', 'monthly_credits_remaining', 'purchased_balance', 'total_credits_used', 'total_creations', 'created_at'];
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [header.join(',')];
    for (const u of rows) {
      lines.push([
        u.email, u.display_name, u.subscription?.plan_slug ?? '', u.subscription?.status ?? '', u.is_blocked,
        u.credits?.monthly_credits_remaining ?? '', u.credits?.purchased_balance ?? '', u.computed.total_credits_used, u.computed.total_creations, u.created_at,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vantly-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!authChecked) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-8 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Not authorized</h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>This area is restricted to vantly-ugc admins.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Admin</h1>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Users', value: stats.users },
          { label: 'Active subs', value: stats.active },
          { label: 'Creations', value: stats.creations },
          { label: 'Credits used', value: stats.creditsUsed.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl px-4 py-3" style={CARD}>
            <div className="text-2xl font-semibold" style={{ color: '#E9E9F0' }}>{s.value}</div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Growth funnel: signups → onboarding → subscription */}
      {growth ? (() => {
        const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
        const ob = growth.onboarding;
        const obTotal = ob.onboarded + ob.in_progress + ob.not_started || 1;
        const steps = Object.entries(ob.by_step).sort((a, b) => b[1] - a[1]);
        const plans = Object.entries(growth.subscriptions.by_plan).sort((a, b) => b[1] - a[1]);
        const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
          <div>
            <div className="text-xl font-semibold" style={{ color: '#E9E9F0' }}>{value}</div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
            {sub ? <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{sub}</div> : null}
          </div>
        );
        const funnel = ob.funnel ?? [];
        return (
          <>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Signups */}
            <div className="rounded-2xl px-4 py-4" style={CARD}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Signups</div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Total" value={growth.signups.total.toLocaleString()} />
                <Stat label="7 days" value={`+${growth.signups.last_7d.toLocaleString()}`} />
                <Stat label="24 hours" value={`+${growth.signups.last_24h.toLocaleString()}`} />
              </div>
            </div>

            {/* Onboarding funnel */}
            <div className="rounded-2xl px-4 py-4" style={CARD}>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Onboarding</div>
                <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{pct(ob.completion_rate)} completed</div>
              </div>
              {/* Stacked bar */}
              <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ width: pct(ob.onboarded / obTotal), background: '#34D399' }} />
                <div style={{ width: pct(ob.in_progress / obTotal), background: '#A78BFA' }} />
                <div style={{ width: pct(ob.not_started / obTotal), background: 'rgba(255,255,255,0.18)' }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Onboarded" value={ob.onboarded.toLocaleString()} />
                <Stat label="In progress" value={ob.in_progress.toLocaleString()} />
                <Stat label="Not started" value={ob.not_started.toLocaleString()} />
              </div>
              {steps.length ? (
                <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>Stuck on: </span>
                  {steps.map(([step, n], i) => (
                    <span key={step}>{i ? ', ' : ''}{step} <span style={{ color: 'rgba(255,255,255,0.85)' }}>{n}</span></span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Subscriptions */}
            <div className="rounded-2xl px-4 py-4" style={CARD}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Subscriptions</div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Active" value={growth.subscriptions.active_total.toLocaleString()} />
                <Stat label="of signups" value={pct(growth.subscriptions.conversion_rate)} sub="conversion" />
                <Stat label="of onboarded" value={pct(growth.subscriptions.conversion_rate_of_onboarded)} sub="conversion" />
              </div>
              {plans.length ? (
                <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                  {plans.map(([plan, n]) => (
                    <span key={plan} className="mr-3 inline-flex items-center gap-1">
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{plan}</span>
                      <span style={{ color: 'rgba(255,255,255,0.85)' }}>{n}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Step-by-step onboarding funnel (event-log cohort only) */}
          {funnel.length ? (
            <div className="mt-3 rounded-2xl px-4 py-4" style={CARD}>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Onboarding funnel</div>
                <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{ob.funnel_started.toLocaleString()} started · since step-tracking shipped</div>
              </div>
              <div className="mt-3 space-y-1.5">
                {funnel.map((f, i) => {
                  const widthPct = `${(f.pct_of_start * 100).toFixed(1)}%`;
                  const isLast = i === funnel.length - 1;
                  return (
                    <div key={f.step} className="flex items-center gap-3">
                      <div className="w-20 shrink-0 text-[12px] capitalize" style={{ color: 'rgba(255,255,255,0.7)' }}>{f.step}</div>
                      <div className="relative h-6 flex-1 overflow-hidden rounded-md" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: widthPct, background: isLast ? 'rgba(52,211,153,0.5)' : 'rgba(167,139,250,0.4)' }} />
                        <div className="absolute inset-0 flex items-center px-2 text-[11px]" style={{ color: '#E9E9F0' }}>
                          {f.reached.toLocaleString()} <span className="ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>({(f.pct_of_start * 100).toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="w-24 shrink-0 text-right text-[12px]" style={{ color: i === 0 ? 'rgba(255,255,255,0.3)' : f.drop_pct >= 0.06 ? '#F87171' : 'rgba(255,255,255,0.55)' }}>
                        {i === 0 ? '—' : `−${f.drop_from_prev} (−${(f.drop_pct * 100).toFixed(1)}%)`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          </>
        );
      })() : null}

      <OpsPanels metrics={metrics} signups={signups} />

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 220 }}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name…" className="h-10 w-full rounded-xl pl-9 pr-3 text-sm outline-none" style={{ background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-10 rounded-xl px-3 text-sm outline-none" style={{ background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
          <option value="recent">Most recent creation</option>
          <option value="credits_used">Most credits used</option>
          <option value="creations">Most creations</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-xl px-3 text-[12px]" style={{ background: '#0F1015', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all signups (incl. free)
        </label>
      </div>

      {/* Bulk-action bar -- only appears once rows are selected */}
      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
          <span className="text-[12px] font-medium" style={{ color: '#C4B5FD' }}>{selected.size} selected</span>
          <button type="button" disabled={bulkBusy} onClick={exportCsv} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Export CSV</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkBlock(true)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Block</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulkBlock(false)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Unblock</button>
          <button type="button" disabled={bulkBusy} onClick={() => setConfirmDeleteIds(Array.from(selected))} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.3)' }}>Delete…</button>
          <button type="button" disabled={bulkBusy} onClick={() => setSelected(new Set())} className="ml-auto text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Clear</button>
        </div>
      ) : null}

      {error ? <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{error}</div> : null}

      {/* User list */}
      <div className="mt-4 overflow-hidden rounded-2xl" style={CARD}>
        {users === null ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>No users.</p>
        ) : (
          <>
          <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} aria-label="Select all" />
            <span className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>Select all ({filtered.length})</span>
          </div>
          <ul>
            {filtered.map((u) => {
              const open = expanded === u.id;
              const left = (u.credits?.monthly_credits_remaining ?? 0) + (u.credits?.purchased_balance ?? 0);
              return (
                <li key={u.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${u.email ?? u.id}`} />
                    <button type="button" onClick={() => setExpanded(open ? null : u.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {open ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }} />}
                      <span className="truncate text-sm" style={{ color: '#E9E9F0' }}>{u.email ?? '(no email)'}</span>
                      {u.subscription ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{u.subscription.plan_slug}</span> : null}
                      {u.is_blocked ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5' }}>Blocked</span> : null}
                    </button>
                    <div className="flex items-center gap-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      <span title="credits left"><Coins className="mr-1 inline h-3 w-3" />{left.toLocaleString()}</span>
                      <span title="credits used">{u.computed.total_credits_used.toLocaleString()} used</span>
                      <span title="creations">{u.computed.total_creations} gens</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy === u.id} onClick={() => giveCredits(u)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>{busy === u.id ? '…' : '+ Credits'}</button>
                      <select disabled={busy === u.id} value="" onChange={(e) => { if (e.target.value === 'free' && !window.confirm(`Downgrade ${u.email ?? u.id} to free? Their monthly allowance zeroes out immediately (purchased credits are kept).`)) return; grantPlan(u, e.target.value); }} className="rounded-lg px-2 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <option value="">Plan…</option>
                        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                        <option value="free">Downgrade to free</option>
                      </select>
                      <button type="button" disabled={busy === u.id} onClick={() => blockUser(u, !u.is_blocked)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: u.is_blocked ? '#34D399' : '#FCA5A5', border: '1px solid rgba(255,255,255,0.1)' }}>{busy === u.id ? '…' : u.is_blocked ? 'Unblock' : 'Block'}</button>
                      <button type="button" disabled={busy === u.id} onClick={() => setConfirmDeleteIds([u.id])} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.2)' }}>Delete</button>
                    </div>
                  </div>
                  {open && (
                    <div className="px-4 pb-4">
                      {u.jobs.length === 0 ? (
                        <p className="py-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No creations yet.</p>
                      ) : (
                        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                          {u.jobs.map((j) => (
                            <div key={j.id} className="flex items-center gap-3 px-3 py-2 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }}>
                              <span className="w-44 shrink-0 truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{j.model_slug ?? '—'}</span>
                              <span className="flex-1 truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{j.prompt ?? ''}</span>
                              <span className="w-16 shrink-0 text-right">{j.credit_cost ?? 0} cr</span>
                              <span className="w-20 shrink-0 text-right" style={{ color: j.status === 'completed' ? '#34D399' : j.status === 'failed' ? '#F87171' : '#A78BFA' }}>{j.status}</span>
                              <span className="w-24 shrink-0 text-right" style={{ color: 'rgba(255,255,255,0.4)' }}>{j.created_at ? new Date(j.created_at).toLocaleDateString() : ''}</span>
                              <span className="w-12 shrink-0 text-right">{j.output_media_url ? <a href={j.output_media_url} target="_blank" rel="noreferrer" style={{ color: '#A78BFA' }}><ExternalLink className="inline h-3.5 w-3.5" /></a> : '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>

      {/* Delete confirmation -- lists exactly which users are about to be
          permanently removed, per the admin-replication plan's spec. This
          is a real hard delete (see 20260904150000_admin_user_moderation.sql):
          it cascades through subscriptions, credits, generation history and
          the credit-transaction ledger with no way back. */}
      {confirmDeleteIds ? (() => {
        const targets = (users ?? []).filter((u) => confirmDeleteIds.includes(u.id));
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Confirm delete">
            <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !bulkBusy && setConfirmDeleteIds(null)} aria-hidden />
            <div className="relative w-full max-w-lg rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(248,113,113,0.08) inset' }}>
              <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>
                Permanently delete {confirmDeleteIds.length} user{confirmDeleteIds.length === 1 ? '' : 's'}?
              </h2>
              <p className="mt-2 text-[13px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                This is irreversible. Their account, subscription, credit balance, generation history, and credit-transaction ledger are all deleted -- nothing is retained.
              </p>
              <div className="mt-3 max-h-48 overflow-y-auto rounded-xl px-3 py-2" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.06)' }}>
                {targets.length === 0 ? (
                  <p className="py-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{confirmDeleteIds.length} user{confirmDeleteIds.length === 1 ? '' : 's'} not currently in view.</p>
                ) : targets.map((u) => (
                  <div key={u.id} className="truncate py-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{u.email ?? u.id}</div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button type="button" disabled={bulkBusy} onClick={() => setConfirmDeleteIds(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
                <button type="button" disabled={bulkBusy} onClick={confirmBulkDelete} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#F87171', color: '#191A22' }}>{bulkBusy ? 'Deleting…' : 'Delete permanently'}</button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
