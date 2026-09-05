// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/mailer -- Templates (the Mailer milestone's landing
 * page; Groups and Campaigns are separate sub-pages linked below). CRUD +
 * preview + send-test, body composed with the same drag-drop Canvas
 * builder (rows/columns/8 block types, Visual/Source Code toggle) that was
 * originally built for Content Management -- moved here instead, since
 * this rich multi-column layout builder is what AutoGPT's own Mailer
 * Template builder actually is; Content Management uses a simpler
 * single-flow WYSIWYG (see components/admin/content-builder/WysiwygEditor.tsx).
 */

import { useEffect, useState, useCallback } from 'react';
import { MailerNav } from '@/components/admin/mailer-nav';
import { Loader2, ShieldAlert, Plus, Eye, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { ContentBuilder } from '@/components/admin/content-builder/ContentBuilder';

interface Template {
  id: string;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  variables: string[];
  status: 'active' | 'archived';
  sent_count: number;
  created_at: string;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

interface EditForm {
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  variables: string; // comma-separated in the UI
}

function templateToForm(t: Template | null): EditForm {
  return {
    name: t?.name ?? '',
    subject: t?.subject ?? '',
    html_content: t?.html_content ?? '<p>Hi {{name}},</p>\n<p></p>',
    text_content: t?.text_content ?? '',
    variables: (t?.variables ?? []).join(', '),
  };
}

export default function AdminMailerTemplatesPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [form, setForm] = useState<EditForm>(templateToForm(null));
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<Template | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mailer/templates', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setTemplates([]); return; }
      if (!r.ok) { setError(`templates ${r.status}`); setTemplates([]); return; }
      const j = await r.json();
      setTemplates(j.templates ?? []);
    } catch (e) { setError((e as Error).message); setTemplates([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  function openEdit(t: Template) { setEditing(t); setForm(templateToForm(t)); }
  function openCreate() { setEditing('new'); setForm(templateToForm(null)); }

  async function toggleArchive(t: Template) {
    const r = await fetch(`/api/admin/mailer/templates/${t.id}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: t.status === 'active' ? 'archived' : 'active' }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
    await load();
  }

  async function openPreview(t: Template) {
    setPreviewing(t);
    setPreviewHtml(null);
    const r = await fetch(`/api/admin/mailer/templates/${t.id}/preview`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const j = await r.json().catch(() => ({}));
    setPreviewHtml(r.ok ? j.html : `<p style="color:#F87171">${j.error ?? 'Preview failed'}</p>`);
  }

  async function sendTest(t: Template) {
    if (!testEmail.trim()) { alert('Enter an email address first'); return; }
    setTestingId(t.id);
    try {
      const r = await fetch(`/api/admin/mailer/templates/${t.id}/send-test`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      alert(`Test sent to ${testEmail.trim()}`);
    } finally { setTestingId(null); }
  }

  async function saveEdit() {
    const isNew = editing === 'new';
    if (!form.name.trim() || !form.subject.trim() || !form.html_content.trim()) {
      alert('Name, subject, and HTML content are required'); return;
    }
    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim(),
      html_content: form.html_content,
      text_content: form.text_content.trim() || null,
      variables: form.variables.split(',').map((s) => s.trim()).filter(Boolean),
    };
    setSaving(true);
    try {
      const url = isNew ? '/api/admin/mailer/templates' : `/api/admin/mailer/templates/${(editing as Template).id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
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
      <MailerNav />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
          <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Mailer — Templates</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openCreate} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
            <Plus className="h-3.5 w-3.5" /> New template
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="test recipient for Send test…" className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ ...INPUT, maxWidth: 260 }} />
      </div>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {templates === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : templates.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No templates yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {templates.map((t) => (
              <li key={t.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{t.name}</span>
                      {t.status === 'archived' ? <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>Archived</span> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {t.subject} · sent {t.sent_count.toLocaleString()}×{t.variables.length ? ` · vars: ${t.variables.join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openPreview(t)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <button type="button" disabled={testingId === t.id} onClick={() => sendTest(t)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(167,139,250,0.1)', color: '#C4B5FD', border: '1px solid rgba(167,139,250,0.2)' }}>
                      <Send className="h-3 w-3" /> {testingId === t.id ? '…' : 'Send test'}
                    </button>
                    <button type="button" onClick={() => toggleArchive(t)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {t.status === 'active' ? 'Archive' : 'Unarchive'}
                    </button>
                    <button type="button" onClick={() => openEdit(t)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      Edit
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'New template' : 'Edit template'}>
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setEditing(null)} aria-hidden />
          {/* Wider than the other mailer dialogs -- the Canvas body builder (rows/columns/inspector) needs real width, same max-w-5xl as Content Management's own editor dialog. */}
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>{editing === 'new' ? 'New template' : `Edit ${form.name}`}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Subject (supports {'{{variables}}'})
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Documented variables (comma-separated, informational)
                <input value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} placeholder="name, plan_name" className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
              </label>
              <div className="col-span-2">
                <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Body content</label>
                <div className="mt-1">
                  <ContentBuilder value={form.html_content} onChange={(html_content) => setForm((f) => ({ ...f, html_content }))} />
                </div>
              </div>
              <label className="col-span-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Plain-text content (optional)
                <textarea value={form.text_content} onChange={(e) => setForm({ ...form, text_content: e.target.value })} rows={4} className="mt-1 w-full rounded-lg px-2.5 py-1.5 font-mono text-[12px]" style={INPUT} />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={saveEdit} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {previewing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Preview">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => setPreviewing(null)} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Preview: {previewing.name}</h2>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Undocumented sample values shown as [bracketed] placeholders.</p>
            <div className="mt-4 rounded-xl bg-white p-4" style={{ minHeight: 200 }}>
              {previewHtml === null ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: '#999' }} /></div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setPreviewing(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
