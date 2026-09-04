// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';
import { CARD, INPUT, MUTED, inputClass, labelClass, primaryButtonClass, primaryButtonStyle } from './_shared';

interface GeneralSettings {
  website_name: string | null;
  support_email: string | null;
  seo_description: string | null;
  company_address: string | null;
  social_links: Record<string, string>;
  updated_at: string | null;
}

const SOCIAL_PLATFORMS = ['twitter', 'instagram', 'youtube', 'discord'] as const;

export function GeneralTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GeneralSettings>({
    website_name: '', support_email: '', seo_description: '', company_address: '', social_links: {}, updated_at: null,
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/settings/general', { credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setForm({
          website_name: j.settings.website_name ?? '',
          support_email: j.settings.support_email ?? '',
          seo_description: j.settings.seo_description ?? '',
          company_address: j.settings.company_address ?? '',
          social_links: j.settings.social_links ?? {},
          updated_at: j.settings.updated_at,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/general', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setForm((f) => ({ ...f, updated_at: j.settings.updated_at }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>;
  }

  return (
    <div className="rounded-2xl px-5 py-5" style={CARD}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} style={{ color: MUTED }}>Website name</label>
          <input className={inputClass} style={INPUT} value={form.website_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, website_name: e.target.value }))} placeholder="Vantly UGC" />
        </div>
        <div>
          <label className={labelClass} style={{ color: MUTED }}>Support email</label>
          <input className={inputClass} style={INPUT} value={form.support_email ?? ''} onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))} placeholder="support@vantly-ugc.com" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} style={{ color: MUTED }}>SEO description</label>
          <textarea rows={3} className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none" style={INPUT} value={form.seo_description ?? ''} onChange={(e) => setForm((f) => ({ ...f, seo_description: e.target.value }))} placeholder="Shown in search results and social previews" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} style={{ color: MUTED }}>Company address</label>
          <input className={inputClass} style={INPUT} value={form.company_address ?? ''} onChange={(e) => setForm((f) => ({ ...f, company_address: e.target.value }))} placeholder="Used in email footers, if applicable" />
        </div>
      </div>

      <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Social links</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <div key={platform}>
              <label className={labelClass} style={{ color: MUTED }}>{platform}</label>
              <input
                className={inputClass}
                style={INPUT}
                value={form.social_links[platform] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, social_links: { ...f.social_links, [platform]: e.target.value } }))}
                placeholder={`https://${platform}.com/...`}
              />
            </div>
          ))}
        </div>
      </div>

      {error ? <p className="mt-4 text-[12px]" style={{ color: '#F87171' }}>{error}</p> : null}

      <div className="mt-5 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={primaryButtonClass} style={primaryButtonStyle}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {saved ? <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: '#34D399' }}><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span> : null}
      </div>
    </div>
  );
}
