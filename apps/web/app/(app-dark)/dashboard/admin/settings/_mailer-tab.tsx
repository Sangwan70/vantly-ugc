// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, Send, KeyRound } from 'lucide-react';
import { CARD, INPUT, TEXT, MUTED, LABEL, inputClass, labelClass, primaryButtonClass, primaryButtonStyle, secondaryButtonClass, secondaryButtonStyle } from './_shared';

interface MailerSettings {
  from_name: string;
  from_email: string;
  reply_to_email: string;
  logo_url: string;
  footer_text: string;
  resend_api_key_set: boolean;
  resend_api_key_source: 'database' | 'env' | 'none';
  updated_at: string | null;
}

export function MailerTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<MailerSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/settings/mailer', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSettings({
        from_name: j.settings.from_name ?? '',
        from_email: j.settings.from_email ?? '',
        reply_to_email: j.settings.reply_to_email ?? '',
        logo_url: j.settings.logo_url ?? '',
        footer_text: j.settings.footer_text ?? '',
        resend_api_key_set: j.settings.resend_api_key_set,
        resend_api_key_source: j.settings.resend_api_key_source,
        updated_at: j.settings.updated_at,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/mailer', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_name: settings.from_name,
          from_email: settings.from_email,
          reply_to_email: settings.reply_to_email,
          logo_url: settings.logo_url,
          footer_text: settings.footer_text,
          ...(apiKeyInput.trim() ? { resend_api_key: apiKeyInput.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setApiKeyInput('');
      setSettings((s) => (s ? {
        ...s,
        resend_api_key_set: j.settings.resend_api_key_set,
        resend_api_key_source: j.settings.resend_api_key_source,
        updated_at: j.settings.updated_at,
      } : s));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (!window.confirm('Clear the stored Resend API key? Sending will fall back to the RESEND_API_KEY env var, if set.')) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/mailer', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_resend_api_key: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear key');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch('/api/admin/settings/mailer/test', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_email: testEmail }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setTestResult({ ok: true, message: `Sent to ${testEmail}` });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setTesting(false);
    }
  }

  if (loading || !settings) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>;
  }

  const keySourceLabel =
    settings.resend_api_key_source === 'database' ? 'Using key stored here'
    : settings.resend_api_key_source === 'env' ? 'Using RESEND_API_KEY env var'
    : 'No API key configured';
  const keySourceColor = settings.resend_api_key_source === 'none' ? '#F87171' : '#34D399';

  return (
    <div className="space-y-3">
      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} style={{ color: MUTED }}>From name</label>
            <input className={inputClass} style={INPUT} value={settings.from_name} onChange={(e) => setSettings((s) => (s ? { ...s, from_name: e.target.value } : s))} placeholder="Vantly UGC" />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>From email</label>
            <input className={inputClass} style={INPUT} value={settings.from_email} onChange={(e) => setSettings((s) => (s ? { ...s, from_email: e.target.value } : s))} placeholder="hello@vantly-ugc.com" />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Reply-to email</label>
            <input className={inputClass} style={INPUT} value={settings.reply_to_email} onChange={(e) => setSettings((s) => (s ? { ...s, reply_to_email: e.target.value } : s))} placeholder="support@vantly-ugc.com" />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Logo URL</label>
            <input className={inputClass} style={INPUT} value={settings.logo_url} onChange={(e) => setSettings((s) => (s ? { ...s, logo_url: e.target.value } : s))} placeholder="https://.../logo.png" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} style={{ color: MUTED }}>Footer text</label>
            <input className={inputClass} style={INPUT} value={settings.footer_text} onChange={(e) => setSettings((s) => (s ? { ...s, footer_text: e.target.value } : s))} placeholder="© Vantly UGC. You're receiving this because you have an account." />
          </div>
          <div>
            <label className={labelClass} style={{ color: MUTED }}>Resend API key</label>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
              <input
                type="password"
                className={inputClass}
                style={INPUT}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings.resend_api_key_set ? '•••••••••••• (leave blank to keep)' : 're_...'}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: keySourceColor }}>{keySourceLabel}</span>
              {settings.resend_api_key_set ? (
                <button type="button" onClick={clearKey} className="text-[11px] underline" style={{ color: MUTED }}>Clear stored key</button>
              ) : null}
            </div>
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

      <div className="rounded-2xl px-5 py-5" style={CARD}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>Send test email</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={inputClass}
            style={{ ...INPUT, maxWidth: 280 }}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button type="button" disabled={testing || !testEmail} onClick={sendTest} className={secondaryButtonClass} style={secondaryButtonStyle}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send test
          </button>
        </div>
        {testResult ? (
          <p className="mt-2 text-[12px]" style={{ color: testResult.ok ? '#34D399' : '#F87171' }}>{testResult.message}</p>
        ) : null}
        <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
          Uses whatever is currently saved above (or the env var, if nothing is saved) — so a successful test here means
          production sending actually works with this exact configuration.
        </p>
      </div>
    </div>
  );
}
