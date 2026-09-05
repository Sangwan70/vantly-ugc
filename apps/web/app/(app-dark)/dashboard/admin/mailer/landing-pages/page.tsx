// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/landing-pages -- public opt-in forms, each tied to a manual recipient group. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert, Plus, Copy, ExternalLink } from 'lucide-react';
import { MailerNav } from '@/components/admin/mailer-nav';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface LandingPage {
  id: string;
  slug: string;
  title: string;
  description: string;
  target_group_id: string;
  status: 'active' | 'disabled';
  success_message: string;
  redirect_url: string | null;
  submit_count: number;
  created_at: string;
  email_groups: { name: string; type: string } | null;
}
interface GroupOption { id: string; name: string; type: string }

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

function emptyForm() {
  return { slug: '', title: '', description: '', target_group_id: '', success_message: "Thanks -- you're subscribed.", redirect_url: '' };
}

export default function AdminMailerLandingPagesPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pages, setPages] = useState<LandingPage[] | null>(null);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LandingPage | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm());
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
      const [pr, gr] = await Promise.all([
        fetch('/api/admin/mailer/landing-pages', { credentials: 'include' }),
        fetch('/api/admin/mailer/groups', { credentials: 'include' }),
      ]);
      if (pr.status === 403) { setError('Not authorized.'); setPages([]); return; }
      if (!pr.ok) { setError(`landing pages ${pr.status}`); setPages([]); return; }
      const pj = await pr.json();
      setPages(pj.landing_pages ?? []);
      if (gr.ok) { const gj = await gr.json(); setGroups((gj.groups ?? []).filter((g: GroupOption) => g.type === 'manual')); }
    } catch (e) { setError((e as Error).message); setPages([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  function openCreate() { setEditing('new'); setForm(emptyForm()); }
  function openEdit(p: LandingPage) {
    setEditing(p);
    setForm({ slug: p.slug, title: p.title, description: p.description, target_group_id: p.target_group_id, success_message: p.success_message, redirect_url: p.redirect_url ?? '' });
  }

  async function save() {
    if (!form.slug.trim() || !form.title.trim() || !form.target_group_id) { alert('Slug, title, and target group are required'); return; }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const url = isNew ? '/api/admin/mailer/landing-pages' : `/api/admin/mailer/landing-pages/${(editing as LandingPage).id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.slug.trim().toLowerCase(),
          title: form.title.trim(),
          description: form.description,
          target_group_id: form.target_group_id,
          success_message: form.success_message,
          redirect_url: form.redirect_url.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setEditing(null);
      await load();
    } finally { setSaving(false); }
  }

  async function toggleStatus(p: LandingPage) {
    const r = await fetch(`/api/admin/mailer/landing-pages/${p.id}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: p.status === 'active' ? 'disabled' : 'active' }),
    });
    if (r.ok) await load();
  }

  async function remove(p: LandingPage) {
    if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    const r = await fetch(`/api/admin/mailer/landing-pages/${p.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) await load();
  }

  function publicUrl(slug: string) {
    return typeof window !== 'undefined' ? `${window.location.origin}/newsletter/${slug}` : `/newsletter/${slug}`;
  }
  async function copyLink(slug: string) {
    try { await navigator.clipboard.writeText(publicUrl(slug)); } catch { /* clipboard may be unavailable -- non-fatal */ }
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
<MailerNav />
      <div className="mt-3 flex items-center justify-between">
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Landing Pages</h1>
        <button type="button" onClick={openCreate} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New page
        </button>
      </div>

      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Each page is a public opt-in form at /newsletter/&lt;slug&gt; -- submissions add the email to the target manual group (and clear any prior unsubscribe for that address).
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}
      {groups.length === 0 && pages !== null ? (
        <p className="mt-4 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>You need at least one manual group before creating a landing page. <Link href="/dashboard/admin/mailer/groups" className="underline">Create one</Link>.</p>
      ) : null}

      {pages === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : pages.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No landing pages yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {pages.map((p) => (
              <li key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{p.title}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)', color: p.status === 'active' ? '#34D399' : 'rgba(255,255,255,0.5)' }}>{p.status}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <span>/newsletter/{p.slug}</span>
                      <button type="button" onClick={() => copyLink(p.slug)} aria-label="Copy link" className="rounded p-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}><Copy className="h-3 w-3" /></button>
                      <a href={publicUrl(p.slug)} target="_blank" rel="noopener noreferrer" aria-label="Open page" className="rounded p-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}><ExternalLink className="h-3 w-3" /></a>
                      <span>· {p.email_groups?.name ?? 'group deleted'} · {p.submit_count.toLocaleString()} submission{p.submit_count === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => openEdit(p)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Edit</button>
                  <button type="button" onClick={() => toggleStatus(p)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>{p.status === 'active' ? 'Disable' : 'Enable'}</button>
                  <button type="button" onClick={() => remove(p)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#F87171', border: '1px solid rgba(255,255,255,0.1)' }}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Landing page">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setEditing(null)} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>{editing === 'new' ? 'New landing page' : 'Edit landing page'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Slug (URL: /newsletter/&lt;slug&gt;)
                <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} placeholder="spring-sale" />
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Description (optional)
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[12px]" style={INPUT} />
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Target group (manual groups only)
                <select value={form.target_group_id} onChange={(e) => setForm({ ...form, target_group_id: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                  <option value="">Select a group…</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Success message
                <input value={form.success_message} onChange={(e) => setForm({ ...form, success_message: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Redirect URL (optional -- overrides the success message)
                <input value={form.redirect_url} onChange={(e) => setForm({ ...form, redirect_url: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} placeholder="https://…" />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={save} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
