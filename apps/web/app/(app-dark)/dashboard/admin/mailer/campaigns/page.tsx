// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/campaigns -- create drafts, send now. No scheduling or open/click tracking in v1. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert, Plus, ArrowLeft, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface Campaign {
  id: string;
  name: string;
  template_id: string;
  group_id: string | null;
  recipient_emails: string[];
  status: 'draft' | 'sending' | 'sent' | 'failed';
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  sent_at: string | null;
  created_at: string;
  email_templates: { name: string } | null;
  email_groups: { name: string } | null;
}
interface TemplateOption { id: string; name: string; status: string }
interface GroupOption { id: string; name: string }

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

const STATUS_COLOR: Record<Campaign['status'], string> = {
  draft: 'rgba(255,255,255,0.6)', sending: '#A78BFA', sent: '#34D399', failed: '#F87171',
};

export default function AdminMailerCampaignsPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [adhocEmails, setAdhocEmails] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const [cr, tr, gr] = await Promise.all([
        fetch('/api/admin/mailer/campaigns', { credentials: 'include' }),
        fetch('/api/admin/mailer/templates', { credentials: 'include' }),
        fetch('/api/admin/mailer/groups', { credentials: 'include' }),
      ]);
      if (cr.status === 403) { setError('Not authorized.'); setCampaigns([]); return; }
      if (!cr.ok) { setError(`campaigns ${cr.status}`); setCampaigns([]); return; }
      const cj = await cr.json();
      setCampaigns(cj.campaigns ?? []);
      if (tr.ok) { const tj = await tr.json(); setTemplates((tj.templates ?? []).filter((t: TemplateOption) => t.status === 'active')); }
      if (gr.ok) { const gj = await gr.json(); setGroups(gj.groups ?? []); }
    } catch (e) { setError((e as Error).message); setCampaigns([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function createCampaign() {
    if (!name.trim() || !templateId) { alert('Name and template are required'); return; }
    const recipient_emails = adhocEmails.split(/[\n\r,]+/).map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      const r = await fetch('/api/admin/mailer/campaigns', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), template_id: templateId, group_id: groupId || null, recipient_emails }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setCreating(false);
      setName(''); setTemplateId(''); setGroupId(''); setAdhocEmails('');
      await load();
    } finally { setSaving(false); }
  }

  async function sendCampaign(c: Campaign) {
    const label = c.email_groups?.name ? `group "${c.email_groups.name}"` : `${c.recipient_emails.length} ad-hoc recipients`;
    if (!window.confirm(`Send "${c.name}" now to ${label}? This sends real emails immediately and can't be undone.`)) return;
    setSendingId(c.id);
    try {
      const r = await fetch(`/api/admin/mailer/campaigns/${c.id}/send`, { method: 'POST', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      alert(`Sent: ${j.total_sent} succeeded, ${j.total_failed} failed`);
      await load();
    } finally { setSendingId(null); }
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
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <Link href="/dashboard/admin/mailer" className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-3 w-3" /> Mailer
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Campaigns</h1>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New campaign
        </button>
      </div>

      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Send now only -- no scheduling, no open/click tracking. Capped at 500 recipients per send; split larger sends into multiple campaigns.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {campaigns === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : campaigns.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No campaigns yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {campaigns.map((c) => (
              <li key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{c.name}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] capitalize" style={{ background: 'rgba(255,255,255,0.08)', color: STATUS_COLOR[c.status] }}>{c.status}</span>
                    </div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {c.email_templates?.name ?? 'template deleted'} → {c.email_groups?.name ?? `${c.recipient_emails.length} recipient${c.recipient_emails.length === 1 ? '' : 's'}`}
                      {c.status === 'sent' || c.status === 'failed' ? ` · ${c.total_sent} sent, ${c.total_failed} failed of ${c.total_recipients}` : null}
                    </div>
                  </div>
                  {c.status === 'draft' ? (
                    <button type="button" disabled={sendingId === c.id} onClick={() => sendCampaign(c)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
                      <Send className="h-3 w-3" /> {sendingId === c.id ? 'Sending…' : 'Send now'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="New campaign">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setCreating(false)} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>New campaign</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Template
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                  <option value="">Select a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Group (optional)
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                  <option value="">No group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Additional recipients (optional, sent alongside the group)
                <textarea value={adhocEmails} onChange={(e) => setAdhocEmails(e.target.value)} rows={3} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[12px]" style={INPUT} placeholder="one@example.com, two@example.com" />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setCreating(false)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={createCampaign} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Creating…' : 'Create draft'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
