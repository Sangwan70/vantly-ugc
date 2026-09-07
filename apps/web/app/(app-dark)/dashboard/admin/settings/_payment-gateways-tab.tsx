// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save, CheckCircle2, KeyRound, RefreshCw, ArrowUpRight, Search } from 'lucide-react';
import { CARD, INPUT, TEXT, MUTED, LABEL, inputClass, labelClass, primaryButtonClass, primaryButtonStyle, secondaryButtonClass, secondaryButtonStyle } from './_shared';

type GatewayId = 'stripe' | 'razorpay' | 'paypal';
type CredentialSource = 'database' | 'env' | 'none';

interface GatewaySettings {
  active_gateway: GatewayId;
  updated_at: string | null;
  stripe_secret_key_set: boolean;
  stripe_secret_key_source: CredentialSource;
  razorpay_key_id: string;
  razorpay_key_secret_set: boolean;
  razorpay_source: CredentialSource;
  paypal_client_id: string;
  paypal_client_secret_set: boolean;
  paypal_mode: 'live' | 'sandbox';
  paypal_source: CredentialSource;
}

interface PlanRow {
  id: string;
  slug: string;
  display_name: string;
  price_usd_cents: number | null;
  is_active: boolean;
  is_purchasable: boolean;
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
  paypal_plan_id: string | null;
}

const GATEWAYS: { value: GatewayId; label: string }[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'razorpay', label: 'RazorPay' },
  { value: 'paypal', label: 'PayPal' },
];

function sourceLabel(source: CredentialSource, envVarHint: string): { text: string; color: string } {
  if (source === 'database') return { text: 'Using key saved here', color: '#34D399' };
  if (source === 'env') return { text: `Using ${envVarHint} env var`, color: '#FBBF24' };
  return { text: 'Not configured', color: '#F87171' };
}

export function PaymentGatewaysTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);

  const [stripeKeyInput, setStripeKeyInput] = useState('');
  const [razorpayKeyId, setRazorpayKeyId] = useState('');
  const [razorpaySecretInput, setRazorpaySecretInput] = useState('');
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalSecretInput, setPaypalSecretInput] = useState('');
  const [paypalMode, setPaypalMode] = useState<'live' | 'sandbox'>('live');
  const [activeGateway, setActiveGateway] = useState<GatewayId>('stripe');

  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingSlug, setSyncingSlug] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [fetchGateway, setFetchGateway] = useState<GatewayId>('stripe');
  const [fetchedPlans, setFetchedPlans] = useState<{ id: string; name: string; amount: number | null; currency: string | null }[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/settings/payment-gateways', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const s = j.settings as GatewaySettings;
      setSettings(s);
      setActiveGateway(s.active_gateway);
      setRazorpayKeyId(s.razorpay_key_id ?? '');
      setPaypalClientId(s.paypal_client_id ?? '');
      setPaypalMode(s.paypal_mode ?? 'live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function loadPlans() {
    try {
      const r = await fetch('/api/admin/plans', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPlans(j.plans ?? []);
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Failed to load plans');
    }
  }

  useEffect(() => { void load(); void loadPlans(); }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/payment-gateways', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_gateway: activeGateway,
          razorpay_key_id: razorpayKeyId,
          paypal_client_id: paypalClientId,
          paypal_mode: paypalMode,
          ...(stripeKeyInput.trim() ? { stripe_secret_key: stripeKeyInput.trim() } : {}),
          ...(razorpaySecretInput.trim() ? { razorpay_key_secret: razorpaySecretInput.trim() } : {}),
          ...(paypalSecretInput.trim() ? { paypal_client_secret: paypalSecretInput.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setStripeKeyInput(''); setRazorpaySecretInput(''); setPaypalSecretInput('');
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(field: 'stripe_secret_key' | 'razorpay_key_secret' | 'paypal_client_secret', label: string) {
    if (!window.confirm(`Clear the stored ${label}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/payment-gateways', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`clear_${field}`]: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear');
    } finally {
      setSaving(false);
    }
  }

  async function syncPlan(slug: string) {
    setSyncingSlug(slug);
    setSyncMessage(null);
    try {
      const r = await fetch(`/api/admin/plans/${slug}/sync-gateway`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSyncMessage(j.warnings?.length ? `${slug}: ${j.warnings.join('; ')}` : `${slug}: synced`);
      await loadPlans();
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncingSlug(null);
    }
  }

  async function syncAll() {
    setSyncingAll(true);
    setSyncMessage(null);
    try {
      const r = await fetch('/api/admin/settings/payment-gateways/sync-all', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const results = j.results as { slug: string; warnings: string[] }[];
      setSyncMessage(results.length ? results.map((r2) => `${r2.slug}: ${r2.warnings.join('; ')}`).join(' | ') : 'All plans synced');
      await loadPlans();
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncingAll(false);
    }
  }

  async function togglePurchasable(plan: PlanRow) {
    try {
      const r = await fetch(`/api/admin/plans/${plan.slug}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !plan.is_active }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await loadPlans();
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Failed to update plan');
    }
  }

  async function fetchFromGateway() {
    setFetching(true);
    setFetchError(null);
    setFetchedPlans(null);
    try {
      const r = await fetch(`/api/admin/settings/payment-gateways/fetch-plans?gateway=${fetchGateway}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setFetchedPlans(j.plans ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setFetching(false);
    }
  }

  if (loading || !settings) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>;
  }

  const stripeSource = sourceLabel(settings.stripe_secret_key_source, 'STRIPE_SECRET_KEY');
  const razorpaySource = sourceLabel(settings.razorpay_source, 'RAZORPAY_API_KEY/SECRET');
  const paypalSource = sourceLabel(settings.paypal_source, 'PAYPAL_CLIENT_ID/SECRET');

  return (
    <div className="space-y-3">
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>Active gateway</p>
        <p className="mb-3 text-[12px]" style={{ color: MUTED }}>
          Which gateway this panel treats as primary for minting/managing plans below. Live checkout keeps using its own
          deploy-time PAYMENT_GATEWAY configuration — see the note at the bottom of this page.
        </p>
        <div className="flex flex-wrap gap-2">
          {GATEWAYS.map((g) => (
            <label
              key={g.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium"
              style={activeGateway === g.value
                ? { background: 'linear-gradient(90deg,#A78BFA,#7C3AED)', color: '#0F1015' }
                : { background: '#1B1C2A', color: TEXT, border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <input
                type="radio"
                name="active_gateway"
                className="h-3.5 w-3.5"
                checked={activeGateway === g.value}
                onChange={() => setActiveGateway(g.value)}
              />
              {g.label}
            </label>
          ))}
        </div>
      </div>

      {/* Stripe */}
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-3 text-[13px] font-semibold" style={{ color: TEXT }}>Stripe</p>
        <div className="max-w-sm">
          <label className={labelClass} style={{ color: MUTED }}>Secret key</label>
          <div className="flex items-center gap-1.5">
            <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
            <input type="password" className={inputClass} style={INPUT} value={stripeKeyInput} onChange={(e) => setStripeKeyInput(e.target.value)} placeholder={settings.stripe_secret_key_set ? '•••••••••••• (leave blank to keep)' : 'sk_live_...'} />
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11px]" style={{ color: stripeSource.color }}>{stripeSource.text}</span>
            {settings.stripe_secret_key_set ? <button type="button" onClick={() => clearSecret('stripe_secret_key', 'Stripe secret key')} className="text-[11px] underline" style={{ color: MUTED }}>Clear stored key</button> : null}
          </div>
        </div>
      </div>

      {/* RazorPay */}
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-3 text-[13px] font-semibold" style={{ color: TEXT }}>RazorPay</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-2xl">
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Key ID</label>
            <input className={inputClass} style={INPUT} value={razorpayKeyId} onChange={(e) => setRazorpayKeyId(e.target.value)} placeholder="rzp_live_..." />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Key secret</label>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
              <input type="password" className={inputClass} style={INPUT} value={razorpaySecretInput} onChange={(e) => setRazorpaySecretInput(e.target.value)} placeholder={settings.razorpay_key_secret_set ? '•••••••••••• (leave blank to keep)' : 'key secret'} />
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between sm:max-w-2xl">
          <span className="text-[11px]" style={{ color: razorpaySource.color }}>{razorpaySource.text}</span>
          {settings.razorpay_key_secret_set ? <button type="button" onClick={() => clearSecret('razorpay_key_secret', 'RazorPay key secret')} className="text-[11px] underline" style={{ color: MUTED }}>Clear stored secret</button> : null}
        </div>
      </div>

      {/* PayPal */}
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-3 text-[13px] font-semibold" style={{ color: TEXT }}>PayPal</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-2xl">
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Client ID</label>
            <input className={inputClass} style={INPUT} value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} placeholder="AVx..." />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Client secret</label>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
              <input type="password" className={inputClass} style={INPUT} value={paypalSecretInput} onChange={(e) => setPaypalSecretInput(e.target.value)} placeholder={settings.paypal_client_secret_set ? '•••••••••••• (leave blank to keep)' : 'client secret'} />
            </div>
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Mode</label>
            <div className="flex gap-2">
              {(['live', 'sandbox'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaypalMode(m)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize"
                  style={paypalMode === m
                    ? { background: 'linear-gradient(90deg,#A78BFA,#7C3AED)', color: '#0F1015' }
                    : { background: '#1B1C2A', color: TEXT, border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between sm:max-w-2xl">
          <span className="text-[11px]" style={{ color: paypalSource.color }}>{paypalSource.text}</span>
          {settings.paypal_client_secret_set ? <button type="button" onClick={() => clearSecret('paypal_client_secret', 'PayPal client secret')} className="text-[11px] underline" style={{ color: MUTED }}>Clear stored secret</button> : null}
        </div>
      </div>

      {error ? <p className="text-[12px]" style={{ color: '#F87171' }}>{error}</p> : null}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={primaryButtonClass} style={primaryButtonStyle}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {saved ? <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: '#34D399' }}><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span> : null}
      </div>

      {/* Plans */}
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-semibold" style={{ color: TEXT }}>Plans on each gateway</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={syncingAll} onClick={syncAll} className={secondaryButtonClass} style={secondaryButtonStyle}>
              {syncingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync all plans
            </button>
            <Link href="/dashboard/admin/plans" className={secondaryButtonClass} style={secondaryButtonStyle}>
              Manage plans <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <p className="mb-3 text-[12px]" style={{ color: MUTED }}>
          Since Stripe plans already exist here, &quot;Sync all plans&quot; mints the same tiers on whichever configured
          gateway(s) are still missing an id for a plan — RazorPay and PayPal end up with the same plans as Stripe. A plan
          with no credentials configured for a gateway is skipped for that gateway only, silently.
        </p>

        {plansError ? <p className="mb-2 text-[12px]" style={{ color: '#F87171' }}>{plansError}</p> : null}
        {syncMessage ? <p className="mb-2 text-[12px]" style={{ color: MUTED }}>{syncMessage}</p> : null}

        {plans === null ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-12 gap-2 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>
                <span className="col-span-3">Plan</span>
                <span className="col-span-1 text-center">Stripe</span>
                <span className="col-span-1 text-center">RazorPay</span>
                <span className="col-span-1 text-center">PayPal</span>
                <span className="col-span-2">Status</span>
                <span className="col-span-4 text-right">Actions</span>
              </div>
              {plans.filter((p) => p.price_usd_cents != null).map((p) => (
                <div key={p.slug} className="grid grid-cols-12 items-center gap-2 px-2 py-2.5 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="col-span-3" style={{ color: TEXT }}>
                    <span className="font-medium">{p.display_name}</span>
                    <span className="ml-1.5" style={{ color: MUTED }}>${((p.price_usd_cents ?? 0) / 100).toFixed(0)}/mo</span>
                  </div>
                  <span className="col-span-1 text-center" style={{ color: p.stripe_price_id ? '#34D399' : MUTED }}>{p.stripe_price_id ? '✓' : '—'}</span>
                  <span className="col-span-1 text-center" style={{ color: p.razorpay_plan_id ? '#34D399' : MUTED }}>{p.razorpay_plan_id ? '✓' : '—'}</span>
                  <span className="col-span-1 text-center" style={{ color: p.paypal_plan_id ? '#34D399' : MUTED }}>{p.paypal_plan_id ? '✓' : '—'}</span>
                  <div className="col-span-2">
                    <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: p.is_active ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)', color: p.is_active ? '#34D399' : MUTED }}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="col-span-4 flex items-center justify-end gap-1.5">
                    <button type="button" disabled={syncingSlug === p.slug} onClick={() => syncPlan(p.slug)} className={secondaryButtonClass} style={secondaryButtonStyle}>
                      {syncingSlug === p.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sync'}
                    </button>
                    <button type="button" onClick={() => togglePurchasable(p)} className={secondaryButtonClass} style={secondaryButtonStyle}>
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fetch from gateway */}
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-3 text-[13px] font-semibold" style={{ color: TEXT }}>Fetch existing plans from a gateway</p>
        <p className="mb-3 text-[12px]" style={{ color: MUTED }}>
          Lists whatever recurring prices/plans already exist directly on the gateway&apos;s own side (e.g. set up by hand
          in a dashboard before this page existed). Read-only — it does not link anything into the table above
          automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={inputClass}
            style={{ ...INPUT, maxWidth: 160 }}
            value={fetchGateway}
            onChange={(e) => setFetchGateway(e.target.value as GatewayId)}
          >
            {GATEWAYS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <button type="button" disabled={fetching} onClick={fetchFromGateway} className={secondaryButtonClass} style={secondaryButtonStyle}>
            {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Fetch
          </button>
        </div>
        {fetchError ? <p className="mt-2 text-[12px]" style={{ color: '#F87171' }}>{fetchError}</p> : null}
        {fetchedPlans ? (
          fetchedPlans.length === 0 ? (
            <p className="mt-2 text-[12px]" style={{ color: MUTED }}>No plans found on this gateway.</p>
          ) : (
            <div className="mt-3 space-y-1">
              {fetchedPlans.map((fp) => (
                <div key={fp.id} className="flex items-center justify-between text-[12px]" style={{ color: TEXT }}>
                  <span>{fp.name}</span>
                  <span style={{ color: MUTED }}>{fp.id}{fp.amount != null ? ` · ${fp.amount} ${fp.currency ?? ''}` : ''}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>

      <p className="text-[11px]" style={{ color: MUTED }}>
        This configures the admin Plans-minting surface only. Live checkout (what a customer actually pays through) is a
        separate deploy-time PAYMENT_GATEWAY setting on the Supabase Edge Functions — rewiring live checkout onto these
        settings is a deliberately separate follow-up, the same way the plans table itself doesn&apos;t drive checkout yet.
      </p>
    </div>
  );
}
