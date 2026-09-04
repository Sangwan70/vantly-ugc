// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/groups -- recipient groups for campaigns. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert, Plus, ArrowLeft, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface Group {
  id: string;
  name: string;
  type: 'manual' | 'all_users';
  members: string[];
  member_count: number;
  created_at: string;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

export default function AdminMailerGroupsPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'manual' | 'all_users'>('manual');
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<Group | null>(null);
  const [uploadText, setUploadText] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mailer/groups', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setGroups([]); return; }
      if (!r.ok) { setError(`groups ${r.status}`); setGroups([]); return; }
      const j = await r.json();
      setGroups(j.groups ?? []);
    } catch (e) { setError((e as Error).message); setGroups([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function createGroup() {
    if (!newName.trim()) { alert('Name is required'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/mailer/groups', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setCreating(false);
      setNewName('');
      setNewType('manual');
      await load();
    } finally { setSaving(false); }
  }

  async function doUpload() {
    if (!uploadingFor) return;
    setUploadBusy(true);
    try {
      const r = await fetch(`/api/admin/mailer/groups/${uploadingFor.id}/upload`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: uploadText }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      alert(`Group now has ${j.group.member_count} members${j.skipped ? ` (${j.skipped} invalid addresses skipped)` : ''}`);
      setUploadingFor(null);
      setUploadText('');
      await load();
    } finally { setUploadBusy(false); }
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
        <h1 className="font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Groups</h1>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New group
        </button>
      </div>

      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        &quot;All users&quot; groups aren&apos;t a saved snapshot -- membership is resolved fresh from every signed-up user when a campaign against them is sent.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {groups === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : groups.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No groups yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {groups.map((g) => (
              <li key={g.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{g.name}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{g.type === 'all_users' ? 'All users' : 'Manual'}</span>
                    </div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {g.type === 'all_users' ? 'Resolved at send time' : `${g.member_count.toLocaleString()} members`}
                    </div>
                  </div>
                  {g.type === 'manual' ? (
                    <button type="button" onClick={() => { setUploadingFor(g); setUploadText(''); }} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Upload className="h-3 w-3" /> Add emails
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="New group">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setCreating(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>New group</h2>
            <label className="mt-4 block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
            </label>
            <label className="mt-3 block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Type
              <select value={newType} onChange={(e) => setNewType(e.target.value as 'manual' | 'all_users')} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                <option value="manual">Manual (add emails yourself)</option>
                <option value="all_users">All users (everyone signed up)</option>
              </select>
            </label>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setCreating(false)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={createGroup} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadingFor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Add emails">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !uploadBusy && setUploadingFor(null)} aria-hidden />
          <div className="relative w-full max-w-md rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Add emails to {uploadingFor.name}</h2>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>One per line, or comma-separated. Invalid addresses are skipped.</p>
            <textarea value={uploadText} onChange={(e) => setUploadText(e.target.value)} rows={8} className="mt-3 w-full rounded-lg px-2.5 py-1.5 font-mono text-[12px]" style={INPUT} placeholder="alice@example.com&#10;bob@example.com" />
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={uploadBusy} onClick={() => setUploadingFor(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={uploadBusy} onClick={doUpload} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{uploadBusy ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
