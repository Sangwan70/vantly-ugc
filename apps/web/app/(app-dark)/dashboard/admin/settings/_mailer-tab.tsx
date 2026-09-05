// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, Send, KeyRound, Ban, Trash2, Search } from 'lucide-react';
import { CARD, INPUT, TEXT, MUTED, LABEL, inputClass, labelClass, primaryButtonClass, primaryButtonStyle, secondaryButtonClass, secondaryButtonStyle } from './_shared';

type Provider = 'resend' | 'postmark' | 'ses' | 'smtp';

interface MailerSettings {
  from_name: string;
  from_email: string;
  reply_to_email: string;
  logo_url: string;
  footer_text: string;
  provider: Provider;
  resend_api_key_set: boolean;
  resend_api_key_source: 'database' | 'env' | 'none';
  postmark_api_key_set: boolean;
  ses_access_key_id: string;
  ses_secret_access_key_set: boolean;
  ses_region: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password_set: boolean;
  smtp_secure: boolean;
  updated_at: string | null;
}

const PROVIDER_OPTIONS: { value: Provider; label: string; disabled?: boolean }[] = [
  { value: 'resend', label: 'Resend' },
  { value: 'postmark', label: 'Postmark' },
  { value: 'ses', label: 'Amazon SES' },
  { value: 'smtp', label: 'SMTP (coming soon)', disabled: true },
];

export function MailerTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<MailerSettings | null>(null);

  const [resendKeyInput, setResendKeyInput] = useState('');
  const [postmarkKeyInput, setPostmarkKeyInput] = useState('');
  const [sesSecretInput, setSesSecretInput] = useState('');
  const [smtpPasswordInput, setSmtpPasswordInput] = useState('');

  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/settings/mailer', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const s = j.settings;
      setSettings({
        from_name: s.from_name ?? '', from_email: s.from_email ?? '', reply_to_email: s.reply_to_email ?? '',
        logo_url: s.logo_url ?? '', footer_text: s.footer_text ?? '',
        provider: s.provider ?? 'resend',
        resend_api_key_set: s.resend_api_key_set, resend_api_key_source: s.resend_api_key_source,
        postmark_api_key_set: s.postmark_api_key_set,
        ses_access_key_id: s.ses_access_key_id ?? '', ses_secret_access_key_set: s.ses_secret_access_key_set, ses_region: s.ses_region ?? '',
        smtp_host: s.smtp_host ?? '', smtp_port: s.smtp_port != null ? String(s.smtp_port) : '', smtp_username: s.smtp_username ?? '',
        smtp_password_set: s.smtp_password_set, smtp_secure: s.smtp_secure ?? true,
        updated_at: s.updated_at,
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
          provider: settings.provider,
          ses_access_key_id: settings.ses_access_key_id,
          ses_region: settings.ses_region,
          smtp_host: settings.smtp_host,
          smtp_port: settings.smtp_port ? Number(settings.smtp_port) : undefined,
          smtp_username: settings.smtp_username,
          smtp_secure: settings.smtp_secure,
          ...(resendKeyInput.trim() ? { resend_api_key: resendKeyInput.trim() } : {}),
          ...(postmarkKeyInput.trim() ? { postmark_api_key: postmarkKeyInput.trim() } : {}),
          ...(sesSecretInput.trim() ? { ses_secret_access_key: sesSecretInput.trim() } : {}),
          ...(smtpPasswordInput.trim() ? { smtp_password: smtpPasswordInput.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResendKeyInput(''); setPostmarkKeyInput(''); setSesSecretInput(''); setSmtpPasswordInput('');
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(field: 'resend_api_key' | 'postmark_api_key' | 'ses_secret_access_key' | 'smtp_password', label: string) {
    if (!window.confirm(`Clear the stored ${label}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/settings/mailer', {
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
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>Sending provider</p>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => setSettings((s) => (s ? { ...s, provider: opt.value } : s))}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
              style={settings.provider === opt.value
                ? { background: 'linear-gradient(90deg,#A78BFA,#7C3AED)', color: '#0F1015' }
                : { background: '#1B1C2A', color: TEXT, border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {settings.provider === 'resend' ? (
          <div className="mt-4 max-w-sm">
            <label className={labelClass} style={{ color: MUTED }}>Resend API key</label>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
              <input type="password" className={inputClass} style={INPUT} value={resendKeyInput} onChange={(e) => setResendKeyInput(e.target.value)} placeholder={settings.resend_api_key_set ? '•••••••••••• (leave blank to keep)' : 're_...'} />
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: keySourceColor }}>{keySourceLabel}</span>
              {settings.resend_api_key_set ? <button type="button" onClick={() => clearSecret('resend_api_key', 'Resend API key')} className="text-[11px] underline" style={{ color: MUTED }}>Clear stored key</button> : null}
            </div>
          </div>
        ) : null}

        {settings.provider === 'postmark' ? (
          <div className="mt-4 max-w-sm">
            <label className={labelClass} style={{ color: MUTED }}>Postmark server token</label>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
              <input type="password" className={inputClass} style={INPUT} value={postmarkKeyInput} onChange={(e) => setPostmarkKeyInput(e.target.value)} placeholder={settings.postmark_api_key_set ? '•••••••••••• (leave blank to keep)' : 'server token'} />
            </div>
            {settings.postmark_api_key_set ? <button type="button" onClick={() => clearSecret('postmark_api_key', 'Postmark server token')} className="mt-1.5 text-[11px] underline" style={{ color: MUTED }}>Clear stored key</button> : null}
          </div>
        ) : null}

        {settings.provider === 'ses' ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-2xl">
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Access key ID</label>
              <input className={inputClass} style={INPUT} value={settings.ses_access_key_id} onChange={(e) => setSettings((s) => (s ? { ...s, ses_access_key_id: e.target.value } : s))} placeholder="AKIA..." />
            </div>
            <div>
              <label className={labelClass} style={{ color: MUTED }}>Region</label>
              <input className={inputClass} style={INPUT} value={settings.ses_region} onChange={(e) => setSettings((s) => (s ? { ...s, ses_region: e.target.value } : s))} placeholder="us-east-1" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} style={{ color: MUTED }}>Secret access key</label>
              <div className="flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 shrink-0" style={{ color: LABEL }} />
                <input type="password" className={inputClass} style={INPUT} value={sesSecretInput} onChange={(e) => setSesSecretInput(e.target.value)} placeholder={settings.ses_secret_access_key_set ? '•••••••••••• (leave blank to keep)' : 'secret key'} />
              </div>
              {settings.ses_secret_access_key_set ? <button type="button" onClick={() => clearSecret('ses_secret_access_key', 'SES secret access key')} className="mt-1.5 text-[11px] underline" style={{ color: MUTED }}>Clear stored key</button> : null}
            </div>
          </div>
        ) : null}

        {settings.provider === 'smtp' ? (
          <p className="mt-4 text-[12px]" style={{ color: MUTED }}>
            SMTP sending isn&apos;t implemented in this build yet -- choose Resend, Postmark, or Amazon SES above.
          </p>
        ) : null}
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

      <SuppressionsPanel />
    </div>
  );
}

interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  created_at: string;
}

function SuppressionsPanel() {
  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(query = '') {
    try {
      const r = await fetch(`/api/admin/mailer/suppressions${query ? `?q=${encodeURIComponent(query)}` : ''}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(j.suppressions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }
  useEffect(() => { void load(); }, []);

  async function addSuppression() {
    if (!newEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/mailer/suppressions', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNewEmail('');
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function removeSuppression(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/mailer/suppressions/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl px-5 py-5" style={CARD}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: LABEL }}>
          <Ban className="h-3.5 w-3.5" /> Unsubscribed / suppressed
        </p>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
        Nothing sends to an address here -- campaigns and automated triggers both check this list before every send.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: LABEL }} />
          <input
            className={inputClass}
            style={{ ...INPUT, maxWidth: 220, paddingLeft: 28 }}
            value={q}
            onChange={(e) => { setQ(e.target.value); void load(e.target.value); }}
            placeholder="Search email..."
          />
        </div>
        <input className={inputClass} style={{ ...INPUT, maxWidth: 240 }} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Manually suppress an address..." />
        <button type="button" disabled={busy || !newEmail.trim()} onClick={addSuppression} className={secondaryButtonClass} style={secondaryButtonStyle}>Suppress</button>
      </div>

      {error ? <p className="mt-2 text-[12px]" style={{ color: '#F87171' }}>{error}</p> : null}

      {rows === null ? (
        <div className="mt-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: MUTED }} /></div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[12px]" style={{ color: MUTED }}>No suppressed addresses.</p>
      ) : (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="min-w-0">
                  <div className="truncate text-[12px]" style={{ color: TEXT }}>{row.email}</div>
                  <div className="text-[10px]" style={{ color: MUTED }}>{row.reason} · {new Date(row.created_at).toLocaleDateString()}</div>
                </div>
                <button type="button" disabled={busy} onClick={() => removeSuppression(row.id)} title="Remove (re-subscribe)" className="shrink-0 rounded-lg p-1.5" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5' }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
