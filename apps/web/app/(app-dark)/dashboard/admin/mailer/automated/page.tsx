// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/automated -- the two fixed lifecycle triggers (welcome, no_subscription_nudge). Config only; dispatch is a cron tick, see lib/mailer/automated-triggers.ts. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert } from 'lucide-react';
import { MailerNav } from '@/components/admin/mailer-nav';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface Trigger {
  trigger_key: 'welcome' | 'no_subscription_nudge';
  enabled: boolean;
  template_id: string | null;
  delay_hours: number;
  email_templates: { name: string } | null;
}
interface TemplateOption { id: string; name: string; status: string }

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

const TRIGGER_LABELS: Record<Trigger['trigger_key'], { title: string; description: string }> = {
  welcome: { title: 'Welcome email', description: 'Sent once, delay_hours after a new user signs up.' },
  no_subscription_nudge: { title: 'No-subscription nudge', description: 'Sent once to a user who still has no active subscription delay_hours after signup.' },
};

export default function AdminMailerAutomatedPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [triggers, setTriggers] = useState<Trigger[] | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const [tr, mr] = await Promise.all([
        fetch('/api/admin/mailer/automated-triggers', { credentials: 'include' }),
        fetch('/api/admin/mailer/templates', { credentials: 'include' }),
      ]);
      if (tr.status === 403) { setError('Not authorized.'); setTriggers([]); return; }
      if (!tr.ok) { setError(`triggers ${tr.status}`); setTriggers([]); return; }
      const tj = await tr.json();
      setTriggers(tj.triggers ?? []);
      if (mr.ok) { const mj = await mr.json(); setTemplates((mj.templates ?? []).filter((t: TemplateOption) => t.status === 'active')); }
    } catch (e) { setError((e as Error).message); setTriggers([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function update(key: string, patch: Record<string, unknown>) {
    setSavingKey(key);
    try {
      const r = await fetch(`/api/admin/mailer/automated-triggers/${key}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setSavingKey(null); }
  }

  if (!authChecked) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-8 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Not authorized</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <MailerNav />
      <h1 className="mt-3 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Automated emails</h1>
      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Two fixed lifecycle emails, evaluated every 15 minutes by the mailer cron tick. Each user gets each one at most once.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}
      {templates.length === 0 && triggers !== null ? (
        <p className="mt-4 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>You need at least one active template before enabling a trigger. <Link href="/dashboard/admin/mailer" className="underline">Create one</Link>.</p>
      ) : null}

      {triggers === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : (
        <div className="mt-6 space-y-4">
          {triggers.map((t) => {
            const label = TRIGGER_LABELS[t.trigger_key];
            const busy = savingKey === t.trigger_key;
            return (
              <div key={t.trigger_key} className="rounded-2xl p-4" style={CARD}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{label.title}</div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{label.description}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => update(t.trigger_key, { enabled: !t.enabled })}
                    className="rounded-full px-3 py-1.5 text-[12px] font-medium"
                    style={{ background: t.enabled ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)', color: t.enabled ? '#34D399' : 'rgba(255,255,255,0.6)' }}
                  >
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Template
                    <select
                      value={t.template_id ?? ''}
                      disabled={busy}
                      onChange={(e) => update(t.trigger_key, { template_id: e.target.value || null })}
                      className="mt-1 w-56 rounded-lg px-2.5 py-1.5 text-[13px]"
                      style={INPUT}
                    >
                      <option value="">No template</option>
                      {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Delay (hours after signup)
                    <input
                      type="number"
                      min={0}
                      defaultValue={t.delay_hours}
                      disabled={busy}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0 && n !== t.delay_hours) update(t.trigger_key, { delay_hours: n });
                      }}
                      className="mt-1 w-28 rounded-lg px-2.5 py-1.5 text-[13px]"
                      style={INPUT}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
