// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { CARD, INPUT, TEXT, MUTED, LABEL, inputClass, labelClass, primaryButtonClass, primaryButtonStyle, secondaryButtonClass, secondaryButtonStyle } from './_shared';

interface Currency {
  id: string;
  code: string;
  symbol: string;
  name: string;
  exchange_rate_to_usd: number;
  is_active: boolean;
  is_default: boolean;
  rate_source: 'manual' | 'fetched';
  rate_updated_at: string;
  updated_at: string;
}

export function CurrencyTab() {
  const [currencies, setCurrencies] = useState<Currency[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ code: '', symbol: '', name: '', exchange_rate_to_usd: '' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/settings/currencies', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCurrencies(j.currencies);
      setRateDrafts(Object.fromEntries((j.currencies as Currency[]).map((c) => [c.code, String(c.exchange_rate_to_usd)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function patch(code: string, body: Record<string, unknown>) {
    setBusy(code);
    setError(null);
    try {
      const r = await fetch(`/api/admin/settings/currencies/${code}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(code: string) {
    if (!window.confirm(`Remove ${code}? This cannot be undone.`)) return;
    setBusy(code);
    setError(null);
    try {
      const r = await fetch(`/api/admin/settings/currencies/${code}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  async function addCurrency() {
    setAdding(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/currencies', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...addForm, exchange_rate_to_usd: Number(addForm.exchange_rate_to_usd) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAddForm({ code: '', symbol: '', name: '', exchange_rate_to_usd: '' });
      setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add currency');
    } finally {
      setAdding(false);
    }
  }

  if (currencies === null) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl px-4 py-2" style={CARD}>
        <div className="grid grid-cols-12 gap-2 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>
          <span className="col-span-3">Currency</span>
          <span className="col-span-3">Rate (per $1 USD)</span>
          <span className="col-span-2">Status</span>
          <span className="col-span-4 text-right">Actions</span>
        </div>
        {currencies.map((c) => (
          <div key={c.code} className="grid grid-cols-12 items-center gap-2 px-2 py-2.5 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="col-span-3 flex items-center gap-2" style={{ color: TEXT }}>
              <span className="w-6 text-center" style={{ color: MUTED }}>{c.symbol}</span>
              <span className="font-medium">{c.code}</span>
              <span className="truncate" style={{ color: MUTED }}>{c.name}</span>
              {c.is_default ? <Star className="h-3.5 w-3.5 shrink-0" style={{ color: '#FBBF24' }} fill="#FBBF24" /> : null}
            </div>
            <div className="col-span-3">
              {c.code === 'USD' ? (
                <span style={{ color: MUTED }}>1.000000 (base)</span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    className="h-8 w-28 rounded-lg px-2 text-[12px] outline-none"
                    style={INPUT}
                    value={rateDrafts[c.code] ?? String(c.exchange_rate_to_usd)}
                    onChange={(e) => setRateDrafts((d) => ({ ...d, [c.code]: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={busy === c.code || rateDrafts[c.code] === String(c.exchange_rate_to_usd)}
                    onClick={() => patch(c.code, { exchange_rate_to_usd: Number(rateDrafts[c.code]) })}
                    className={secondaryButtonClass}
                    style={secondaryButtonStyle}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
            <div className="col-span-2">
              <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: c.is_active ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)', color: c.is_active ? '#34D399' : MUTED }}>
                {c.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="col-span-4 flex items-center justify-end gap-1.5">
              {!c.is_default ? (
                <button type="button" disabled={busy === c.code} onClick={() => patch(c.code, { is_default: true })} className={secondaryButtonClass} style={secondaryButtonStyle}>
                  Set default
                </button>
              ) : null}
              {!c.is_default ? (
                <button type="button" disabled={busy === c.code} onClick={() => patch(c.code, { is_active: !c.is_active })} className={secondaryButtonClass} style={secondaryButtonStyle}>
                  {c.is_active ? 'Deactivate' : 'Activate'}
                </button>
              ) : null}
              {c.code !== 'USD' && !c.is_default ? (
                <button type="button" disabled={busy === c.code} onClick={() => remove(c.code)} className={secondaryButtonClass} style={{ ...secondaryButtonStyle, color: '#F87171' }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="text-[12px]" style={{ color: '#F87171' }}>{error}</p> : null}

      {showAdd ? (
        <div className="rounded-2xl px-4 py-4" style={CARD}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Code</label>
              <input className={inputClass} style={INPUT} value={addForm.code} onChange={(e) => setAddForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="INR" maxLength={3} />
            </div>
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Symbol</label>
              <input className={inputClass} style={INPUT} value={addForm.symbol} onChange={(e) => setAddForm((f) => ({ ...f, symbol: e.target.value }))} placeholder="₹" />
            </div>
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Name</label>
              <input className={inputClass} style={INPUT} value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="Indian Rupee" />
            </div>
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Rate per $1</label>
              <input className={inputClass} style={INPUT} value={addForm.exchange_rate_to_usd} onChange={(e) => setAddForm((f) => ({ ...f, exchange_rate_to_usd: e.target.value }))} placeholder="83.5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={adding} onClick={addCurrency} className={primaryButtonClass} style={primaryButtonStyle}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add currency
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className={secondaryButtonClass} style={secondaryButtonStyle}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowAdd(true)} className={secondaryButtonClass} style={secondaryButtonStyle}>
          <Plus className="h-3.5 w-3.5" /> Add currency
        </button>
      )}

      <p className="text-[11px]" style={{ color: MUTED }}>
        This configures which currencies are available and their USD exchange rate. Checkout still charges in the default
        currency only — per-currency Stripe pricing is wired up when the Plans admin feature is built.
      </p>
    </div>
  );
}
