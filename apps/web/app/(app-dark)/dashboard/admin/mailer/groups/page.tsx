// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/groups -- recipient groups for campaigns. */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Plus, Upload, X, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { MailerNav } from '@/components/admin/mailer-nav';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

type SmartField = 'plan_slug' | 'subscription_status' | 'signup_days_ago';
type SmartOp = 'eq' | 'ne' | 'in' | 'gte' | 'lte';
interface SmartCondition { field: SmartField; op: SmartOp; value: string | number | string[] }
interface SmartRules { match: 'all' | 'any'; conditions: SmartCondition[] }

interface Group {
  id: string;
  name: string;
  type: 'manual' | 'all_users' | 'smart';
  members: string[];
  member_count: number;
  smart_rules: SmartRules | null;
  created_at: string;
}

const FIELD_OPTIONS: { value: SmartField; label: string }[] = [
  { value: 'plan_slug', label: 'Plan' },
  { value: 'subscription_status', label: 'Subscription status' },
  { value: 'signup_days_ago', label: 'Days since signup' },
];
const OP_OPTIONS: { value: SmartOp; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'in', label: 'is one of' },
  { value: 'gte', label: 'is at least' },
  { value: 'lte', label: 'is at most' },
];
function emptyCondition(): SmartCondition { return { field: 'plan_slug', op: 'eq', value: '' }; }
function emptyRules(): SmartRules { return { match: 'all', conditions: [emptyCondition()] }; }

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

function RuleBuilder({ rules, setRules, onPreview, previewBusy, previewResult }: {
  rules: SmartRules;
  setRules: (r: SmartRules) => void;
  onPreview: () => void;
  previewBusy: boolean;
  previewResult: { count: number; sample: string[] } | null;
}) {
  function updateCondition(index: number, patch: Partial<SmartCondition>) {
    setRules({ ...rules, conditions: rules.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }
  function addCondition() {
    setRules({ ...rules, conditions: [...rules.conditions, emptyCondition()] });
  }
  function removeCondition(index: number) {
    setRules({ ...rules, conditions: rules.conditions.filter((_, i) => i !== index) });
  }
  return (
    <div className="mt-1 space-y-2 rounded-xl p-3" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Match
        <select value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as 'all' | 'any' })} className="rounded-lg px-2 py-1 text-[12px]" style={INPUT}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        of the following:
      </div>
      {rules.conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as SmartField })} className="rounded-lg px-2 py-1 text-[12px]" style={INPUT}>
            {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value as SmartOp })} className="rounded-lg px-2 py-1 text-[12px]" style={INPUT}>
            {OP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={Array.isArray(c.value) ? c.value.join(',') : c.value}
            onChange={(e) => updateCondition(i, { value: c.op === 'in' ? e.target.value.split(',').map((s) => s.trim()) : e.target.value })}
            placeholder={c.field === 'signup_days_ago' ? 'e.g. 7' : c.field === 'plan_slug' ? 'e.g. pro' : 'e.g. active'}
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[12px]"
            style={INPUT}
          />
          <button type="button" onClick={() => removeCondition(i)} aria-label="Remove rule" className="rounded-lg p-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={addCondition} className="text-[12px] font-medium" style={{ color: '#C4B5FD' }}>+ Add rule</button>
        <button type="button" onClick={onPreview} disabled={previewBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Sparkles className="h-3 w-3" /> {previewBusy ? 'Checking…' : 'Preview matches'}
        </button>
      </div>
      {previewResult ? (
        <div className="rounded-lg px-2.5 py-2 text-[12px]" style={{ background: 'rgba(167,139,250,0.08)', color: '#C4B5FD' }}>
          {previewResult.count.toLocaleString()} user{previewResult.count === 1 ? '' : 's'} match
          {previewResult.sample.length > 0 ? ` -- e.g. ${previewResult.sample.slice(0, 5).join(', ')}${previewResult.count > 5 ? ', …' : ''}` : ''}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminMailerGroupsPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'manual' | 'all_users' | 'smart'>('manual');
  const [newRules, setNewRules] = useState<SmartRules>(emptyRules());
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<Group | null>(null);
  const [uploadText, setUploadText] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [editingRulesFor, setEditingRulesFor] = useState<Group | null>(null);
  const [editRules, setEditRules] = useState<SmartRules>(emptyRules());
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ count: number; sample: string[] } | null>(null);

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
    if (newType === 'smart' && newRules.conditions.every((c) => String(c.value).trim() === '')) {
      alert('Add at least one rule with a value'); return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/mailer/groups', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), type: newType, smart_rules: newType === 'smart' ? newRules : undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setCreating(false);
      setNewName('');
      setNewType('manual');
      setNewRules(emptyRules());
      setPreviewResult(null);
      await load();
    } finally { setSaving(false); }
  }

  async function saveRules() {
    if (!editingRulesFor) return;
    if (editRules.conditions.every((c) => String(c.value).trim() === '')) { alert('Add at least one rule with a value'); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/mailer/groups/${editingRulesFor.id}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smart_rules: editRules }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setEditingRulesFor(null);
      setPreviewResult(null);
      await load();
    } finally { setSaving(false); }
  }

  async function previewRules(rules: SmartRules) {
    setPreviewBusy(true);
    setPreviewResult(null);
    try {
      const r = await fetch('/api/admin/mailer/groups/preview', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smart_rules: rules }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setPreviewResult({ count: j.count, sample: j.sample ?? [] });
    } finally { setPreviewBusy(false); }
  }

  function ruleSummary(rules: SmartRules | null): string {
    if (!rules || rules.conditions.length === 0) return 'No rules';
    const opLabel = (op: SmartOp) => OP_OPTIONS.find((o) => o.value === op)?.label ?? op;
    const fieldLabel = (field: SmartField) => FIELD_OPTIONS.find((f) => f.value === field)?.label ?? field;
    const parts = rules.conditions.map((c) => `${fieldLabel(c.field)} ${opLabel(c.op)} ${Array.isArray(c.value) ? c.value.join(', ') : c.value}`);
    return parts.join(rules.match === 'all' ? ' AND ' : ' OR ');
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
      <MailerNav />
      <div className="mt-3 flex items-center justify-between">
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
                      <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(167,139,250,0.12)', color: '#C4B5FD' }}>{g.type === 'all_users' ? 'All users' : g.type === 'smart' ? 'Smart' : 'Manual'}</span>
                    </div>
                    <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {g.type === 'all_users' ? 'Resolved at send time' : g.type === 'smart' ? ruleSummary(g.smart_rules) : `${g.member_count.toLocaleString()} members`}
                    </div>
                  </div>
                  {g.type === 'manual' ? (
                    <button type="button" onClick={() => { setUploadingFor(g); setUploadText(''); }} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Upload className="h-3 w-3" /> Add emails
                    </button>
                  ) : null}
                  {g.type === 'smart' ? (
                    <button type="button" onClick={() => { setEditingRulesFor(g); setEditRules(g.smart_rules ?? emptyRules()); setPreviewResult(null); }} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <Sparkles className="h-3 w-3" /> Edit rules
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
              <select value={newType} onChange={(e) => { setNewType(e.target.value as 'manual' | 'all_users' | 'smart'); setPreviewResult(null); }} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT}>
                <option value="manual">Manual (add emails yourself)</option>
                <option value="all_users">All users (everyone signed up)</option>
                <option value="smart">Smart (rule-based, e.g. plan or signup date)</option>
              </select>
            </label>
            {newType === 'smart' ? (
              <RuleBuilder rules={newRules} setRules={setNewRules} onPreview={() => previewRules(newRules)} previewBusy={previewBusy} previewResult={previewResult} />
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => { setCreating(false); setPreviewResult(null); }} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
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

      {editingRulesFor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Edit rules">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setEditingRulesFor(null)} aria-hidden />
          <div className="relative w-full max-w-lg rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Edit rules for {editingRulesFor.name}</h2>
            <RuleBuilder rules={editRules} setRules={setEditRules} onPreview={() => previewRules(editRules)} previewBusy={previewBusy} previewResult={previewResult} />
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => { setEditingRulesFor(null); setPreviewResult(null); }} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving} onClick={saveRules} className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
