// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/plans -- manage the canonical `plans` table (Admin Plans
 * Phase 1, see 20260904160000_plans_table.sql). Purely additive: nothing
 * live reads this table yet, so every action here is safe to use freely --
 * there is no existing-subscriber or live-checkout risk in this page.
 * Rewiring checkout/credits-check/webhooks onto this table is a separate,
 * deliberately later step.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Pencil, RefreshCw, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface Plan {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  badge: string | null;
  features: string[];
  monthly_credits: number;
  price_usd_cents: number | null;
  max_resolution: string | null;
  max_video_duration_seconds: number | null;
  has_watermark: boolean;
  has_priority: boolean;
  has_api_access: boolean;
  max_concurrent_jobs: number;
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
  is_active: boolean;
  is_purchasable: boolean;
  sort_order: number;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

interface EditForm {
  slug: string;
  display_name: string;
  description: string;
  badge: string;
  features: string; // newline-separated in the UI, split into an array on save
  monthly_credits: string;
  price_usd_dollars: string; // dollars in the UI, converted to price_usd_cents on save
  max_resolution: string;
  max_video_duration_seconds: string;
  has_watermark: boolean;
  has_priority: boolean;
  has_api_access: boolean;
  max_concurrent_jobs: string;
  is_active: boolean;
  is_purchasable: boolean;
  sort_order: string;
}

function planToForm(p: Plan | null): EditForm {
  return {
    slug: p?.slug ?? '',
    display_name: p?.display_name ?? '',
    description: p?.description ?? '',
    badge: p?.badge ?? '',
    features: (p?.features ?? []).join('\n'),
    monthly_credits: String(p?.monthly_credits ?? 0),
    price_usd_dollars: p?.price_usd_cents != null ? (p.price_usd_cents / 100).toFixed(2) : '',
    max_resolution: p?.max_resolution ?? '',
    max_video_duration_seconds: p?.max_video_duration_seconds != null ? String(p.max_video_duration_seconds) : '',
    has_watermark: p?.has_watermark ?? true,
    has_priority: p?.has_priority ?? false,
    has_api_access: p?.has_api_access ?? false,
    max_concurrent_jobs: String(p?.max_concurrent_jobs ?? 1),
    is_active: p?.is_active ?? true,
    is_purchasable: p?.is_purchasable ?? true,
    sort_order: String(p?.sort_order ?? 0),
  };
}

export default function AdminPlansPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [form, setForm] = useState<EditForm>(planToForm(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/plans', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setPlans([]); return; }
      if (!r.ok) { setError(`plans ${r.status}`); setPlans([]); return; }
      const j = await r.json();
      setPlans(j.plans ?? []);
    } catch (e) { setError((e as Error).message); setPlans([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  function openEdit(p: Plan) { setEditing(p); setForm(planToForm(p)); }
  function openCreate() { setEditing('new'); setForm(planToForm(null)); }
  function closeEdit() { if (!saving) { setEditing(null); } }

  async function toggleFlag(p: Plan, field: 'is_active' | 'is_purchasable') {
    setBusy(p.slug);
    try {
      const r = await fetch(`/api/admin/plans/${encodeURIComponent(p.slug)}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !p[field] }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setBusy(null); }
  }

  async function syncGateway(p: Plan) {
    setBusy(p.slug);
    try {
      const r = await fetch(`/api/admin/plans/${encodeURIComponent(p.slug)}/sync-gateway`, { method: 'POST', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      if (j.warnings?.length) alert(`Synced with warnings:\n${j.warnings.join('\n')}`);
      await load();
    } finally { setBusy(null); }
  }

  async function saveEdit() {
    if (!editing) return;
    const isNew = editing === 'new';
    const existingPriceCents = isNew ? null : editing.price_usd_cents;
    const newPriceCents = form.price_usd_dollars.trim() === '' ? null : Math.round(parseFloat(form.price_usd_dollars) * 100);

    if (newPriceCents !== null && !Number.isFinite(newPriceCents)) { alert('Invalid price'); return; }
    if (newPriceCents !== existingPriceCents) {
      const label = newPriceCents === null ? 'clear the price' : `set the price to $${(newPriceCents / 100).toFixed(2)}`;
      if (!window.confirm(`This will ${label} and mint a NEW Stripe price + RazorPay plan (both treat prices as immutable, so this never touches an existing subscriber's price). Continue?`)) return;
    }

    const payload: Record<string, unknown> = {
      display_name: form.display_name.trim(),
      description: form.description.trim() || null,
      badge: form.badge.trim() || null,
      features: form.features.split('\n').map((s) => s.trim()).filter(Boolean),
      monthly_credits: parseInt(form.monthly_credits, 10) || 0,
      price_usd_cents: newPriceCents,
      max_resolution: form.max_resolution.trim() || null,
      max_video_duration_seconds: form.max_video_duration_seconds.trim() === '' ? null : parseInt(form.max_video_duration_seconds, 10),
      has_watermark: form.has_watermark,
      has_priority: form.has_priority,
      has_api_access: form.has_api_access,
      max_concurrent_jobs: parseInt(form.max_concurrent_jobs, 10) || 1,
      is_active: form.is_active,
      is_purchasable: form.is_purchasable,
      sort_order: parseInt(form.sort_order, 10) || 0,
    };
    if (isNew) payload.slug = form.slug.trim();
    if (isNew && !payload.slug) { alert('slug is required'); return; }

    setSaving(true);
    try {
      const url = isNew ? '/api/admin/plans' : `/api/admin/plans/${encodeURIComponent((editing as Plan).slug)}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      if (j.warnings?.length) alert(`Saved with warnings:\n${j.warnings.join('\n')}\n\nUse "Sync gateway" on this plan to retry.`);
      setEditing(null);
      await load();
    } finally { setSaving(false); }
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
          <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Plans</h1>
        </div>
        <button type="button" onClick={openCreate} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New plan
        </button>
      </div>

      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Phase 1: this table is not yet read by checkout, webhooks, or credits-check -- edits here are safe to make freely and have no live effect until that rewiring happens as its own separate step.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {plans === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {plans.map((p) => (
              <li key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{p.display_name}</span>
                      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.slug}</span>
                      {p.badge ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{p.badge}</span> : null}
                      {!p.is_active ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5' }}>Inactive</span> : null}
                      {!p.is_purchasable ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>Not purchasable</span> : null}
                    </div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {p.price_usd_cents != null ? `$${(p.price_usd_cents / 100).toFixed(2)}/mo` : 'No price'} · {p.monthly_credits.toLocaleString()} credits
                      {p.price_usd_cents != null ? (
                        <>
                          {' '}· Stripe {p.stripe_price_id ? '✓' : '✗'} · RazorPay {p.razorpay_plan_id ? '✓' : '✗'}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={busy === p.slug} onClick={() => toggleFlag(p, 'is_active')} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: p.is_active ? '#FCA5A5' : '#34D399', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {busy === p.slug ? '…' : p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" disabled={busy === p.slug} onClick={() => toggleFlag(p, 'is_purchasable')} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {p.is_purchasable ? 'Hide from checkout' : 'Allow purchase'}
                    </button>
                    {p.price_usd_cents != null && (!p.stripe_price_id || !p.razorpay_plan_id) ? (
                      <button type="button" disabled={busy === p.slug} onClick={() => syncGateway(p)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(167,139,250,0.1)', color: '#C4B5FD', border: '1px solid rgba(167,139,250,0.2)' }}>
                        <RefreshCw className="h-3 w-3" /> Sync gateway
                      </button>
                    ) : null}
                    <button type="button" onClick={() => openEdit(p)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Create plan' : 'Edit plan'}>
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={closeEdit} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>{editing === 'new' ? 'New plan' : `Edit ${form.display_name || form.slug}`}</h2>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {editing === 'new' ? (
                <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Slug
                  <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} placeholder="e.g. growth" />
                </label>
              ) : null}
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Display name
                <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Description
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Badge
                <input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} placeholder="e.g. Most popular" />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Sort order
                <input value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Features (one per line)
                <textarea value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} rows={3} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Monthly credits
                <input value={form.monthly_credits} onChange={(e) => setForm({ ...form, monthly_credits: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Price (USD/mo, blank = no price)
                <input value={form.price_usd_dollars} onChange={(e) => setForm({ ...form, price_usd_dollars: e.target.value })} placeholder="39.00" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Max resolution
                <input value={form.max_resolution} onChange={(e) => setForm({ ...form, max_resolution: e.target.value })} placeholder="1080p" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Max video seconds
                <input value={form.max_video_duration_seconds} onChange={(e) => setForm({ ...form, max_video_duration_seconds: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Max concurrent jobs
                <input value={form.max_concurrent_jobs} onChange={(e) => setForm({ ...form, max_concurrent_jobs: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <div className="col-span-2 mt-1 flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <input type="checkbox" checked={form.has_watermark} onChange={(e) => setForm({ ...form, has_watermark: e.target.checked })} /> Watermark
                </label>
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <input type="checkbox" checked={form.has_priority} onChange={(e) => setForm({ ...form, has_priority: e.target.checked })} /> Priority queue
                </label>
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <input type="checkbox" checked={form.has_api_access} onChange={(e) => setForm({ ...form, has_api_access: e.target.checked })} /> API access
                </label>
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
                </label>
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <input type="checkbox" checked={form.is_purchasable} onChange={(e) => setForm({ ...form, is_purchasable: e.target.checked })} /> Purchasable
                </label>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={closeEdit} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={saveEdit} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
