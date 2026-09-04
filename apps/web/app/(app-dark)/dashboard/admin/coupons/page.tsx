// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/coupons -- manage internal discount codes.
 *
 * Phase 1 (see 20260904170000_add_coupons.sql): CREDITS-type coupons are
 * fully live (redemption actually grants credits). PERCENT_OFF/FIXED_OFF
 * coupons can be created and redeemed here (the redemption is recorded),
 * but nothing in checkout applies that discount to a real charge yet --
 * that's a deliberately separate, later change, same reasoning as the
 * Admin Plans Phase 2 split.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Plus, Users as UsersIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

type CouponType = 'percent_off' | 'fixed_off' | 'credits';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  percent_off: number | null;
  fixed_off_cents: number | null;
  credits_amount: number | null;
  applicable_plans: string[];
  max_redemptions: number | null;
  times_redeemed: number;
  per_user_limit: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

interface Redemption {
  id: string;
  user_id: string;
  email: string | null;
  plan_slug: string | null;
  redeemed_at: string;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, matches the plan doc's rationale

function generateCode(len = 8): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function discountLabel(c: Coupon): string {
  if (c.type === 'percent_off') return `${c.percent_off}% off`;
  if (c.type === 'fixed_off') return `$${((c.fixed_off_cents ?? 0) / 100).toFixed(2)} off`;
  return `${(c.credits_amount ?? 0).toLocaleString()} credits`;
}

interface CreateForm {
  code: string;
  description: string;
  type: CouponType;
  percent_off: string;
  fixed_off_dollars: string;
  credits_amount: string;
  applicable_plans: string;
  max_redemptions: string;
  per_user_limit: string;
  valid_until: string;
}

function blankForm(): CreateForm {
  return {
    code: generateCode(),
    description: '',
    type: 'credits',
    percent_off: '',
    fixed_off_dollars: '',
    credits_amount: '',
    applicable_plans: '',
    max_redemptions: '',
    per_user_limit: '1',
    valid_until: '',
  };
}

export default function AdminCouponsPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(blankForm());
  const [saving, setSaving] = useState(false);
  const [redemptionsFor, setRedemptionsFor] = useState<Coupon | null>(null);
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/coupons', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setCoupons([]); return; }
      if (!r.ok) { setError(`coupons ${r.status}`); setCoupons([]); return; }
      const j = await r.json();
      setCoupons(j.coupons ?? []);
    } catch (e) { setError((e as Error).message); setCoupons([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function toggleActive(c: Coupon) {
    setBusy(c.id);
    try {
      const r = await fetch(`/api/admin/coupons/${c.id}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setBusy(null); }
  }

  async function openRedemptions(c: Coupon) {
    setRedemptionsFor(c);
    setRedemptions(null);
    const r = await fetch(`/api/admin/coupons/${c.id}/redemptions`, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    setRedemptions(r.ok ? (j.redemptions ?? []) : []);
  }

  async function saveCreate() {
    const code = form.code.trim().toUpperCase();
    if (!code) { alert('Code is required'); return; }

    const payload: Record<string, unknown> = {
      code,
      description: form.description.trim() || undefined,
      type: form.type,
      applicable_plans: form.applicable_plans.split(',').map((s) => s.trim()).filter(Boolean),
      max_redemptions: form.max_redemptions.trim() === '' ? undefined : parseInt(form.max_redemptions, 10),
      per_user_limit: form.per_user_limit.trim() === '' ? undefined : parseInt(form.per_user_limit, 10),
      valid_until: form.valid_until.trim() || undefined,
    };
    if (form.type === 'percent_off') {
      const v = parseInt(form.percent_off, 10);
      if (!Number.isFinite(v) || v < 1 || v > 100) { alert('percent_off must be 1-100'); return; }
      payload.percent_off = v;
    } else if (form.type === 'fixed_off') {
      const v = Math.round(parseFloat(form.fixed_off_dollars) * 100);
      if (!Number.isFinite(v) || v <= 0) { alert('Enter a valid dollar amount'); return; }
      payload.fixed_off_cents = v;
    } else {
      const v = parseInt(form.credits_amount, 10);
      if (!Number.isFinite(v) || v <= 0) { alert('Enter a valid credits amount'); return; }
      payload.credits_amount = v;
    }

    setSaving(true);
    try {
      const r = await fetch('/api/admin/coupons', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setCreating(false);
      setForm(blankForm());
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
          <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Coupons</h1>
        </div>
        <button type="button" onClick={() => { setForm(blankForm()); setCreating(true); }} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New coupon
        </button>
      </div>

      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Credits coupons grant real credits on redemption. Percent-off and fixed-off coupons record the redemption but aren&apos;t applied to a live Stripe charge yet -- that&apos;s a separate follow-up.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {coupons === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : coupons.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No coupons yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {coupons.map((c) => {
              const expired = c.valid_until ? new Date(c.valid_until) < new Date() : false;
              const capped = c.max_redemptions != null && c.times_redeemed >= c.max_redemptions;
              return (
                <li key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium" style={{ color: '#E9E9F0' }}>{c.code}</span>
                        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{discountLabel(c)}</span>
                        {!c.is_active ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5' }}>Inactive</span> : null}
                        {expired ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(248,113,113,0.12)', color: '#FCA5A5' }}>Expired</span> : null}
                        {capped ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>Fully redeemed</span> : null}
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {c.description || 'No description'} · {c.times_redeemed}{c.max_redemptions != null ? `/${c.max_redemptions}` : ''} redeemed · limit {c.per_user_limit}/user
                        {c.applicable_plans.length > 0 ? ` · plans: ${c.applicable_plans.join(', ')}` : ' · all plans'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openRedemptions(c)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <UsersIcon className="h-3 w-3" /> Redemptions
                      </button>
                      <button type="button" disabled={busy === c.id} onClick={() => toggleActive(c)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: c.is_active ? '#FCA5A5' : '#34D399', border: '1px solid rgba(255,255,255,0.1)' }}>
                        {busy === c.id ? '…' : c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {creating ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="New coupon">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setCreating(false)} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>New coupon</h2>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Discount type and amount can&apos;t be changed after creation -- deactivate and create a new one instead.</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Code
                <div className="mt-1 flex gap-2">
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full rounded-lg px-2.5 py-1.5 font-mono text-[13px]" style={INPUT} />
                  <button type="button" onClick={() => setForm({ ...form, code: generateCode() })} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Generate</button>
                </div>
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Description
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Type
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CouponType })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                  <option value="credits">Credits</option>
                  <option value="percent_off">Percent off</option>
                  <option value="fixed_off">Fixed amount off</option>
                </select>
              </label>
              {form.type === 'percent_off' ? (
                <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Percent off (1-100)
                  <input value={form.percent_off} onChange={(e) => setForm({ ...form, percent_off: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
              ) : form.type === 'fixed_off' ? (
                <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Amount off (USD)
                  <input value={form.fixed_off_dollars} onChange={(e) => setForm({ ...form, fixed_off_dollars: e.target.value })} placeholder="10.00" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
              ) : (
                <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Credits
                  <input value={form.credits_amount} onChange={(e) => setForm({ ...form, credits_amount: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
              )}
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Applicable plans (comma-separated slugs, blank = all)
                <input value={form.applicable_plans} onChange={(e) => setForm({ ...form, applicable_plans: e.target.value })} placeholder="starter, creator" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Max redemptions (blank = unlimited)
                <input value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Per-user limit
                <input value={form.per_user_limit} onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })} type="number" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Expires (blank = never)
                <input value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} type="date" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setCreating(false)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={saveCreate} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {redemptionsFor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Redemptions">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => setRedemptionsFor(null)} aria-hidden />
          <div className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="font-mono text-base font-semibold" style={{ color: '#E9E9F0' }}>{redemptionsFor.code} redemptions</h2>
            <div className="mt-3">
              {redemptions === null ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
              ) : redemptions.length === 0 ? (
                <p className="py-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No redemptions yet.</p>
              ) : (
                <div className="rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  {redemptions.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)' }}>
                      <span className="truncate">{r.email ?? r.user_id}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{new Date(r.redeemed_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setRedemptionsFor(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
