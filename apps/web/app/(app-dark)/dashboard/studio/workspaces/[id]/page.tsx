// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/studio/workspaces/[id] — workspace administration:
 * members & roles, invites, the shared ElevenLabs account, governance
 * policies (approval, voice consent, SSO, budgets, retention, data region,
 * disclosure, webhook), usage reports, voice consents and the audit log.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Copy, Download, KeyRound, Loader2, ScrollText, ShieldCheck, Trash2, Users, Wallet } from 'lucide-react';
import { studioApi, type Consent, type Role, type WorkspaceSettings } from '../../_lib/api';
import { Btn, C, Field, Input, Select } from '../../_components/ui';

type WsData = Awaited<ReturnType<typeof studioApi.workspace>>;
type Usage = Awaited<ReturnType<typeof studioApi.usage>>;
type AuditEv = Awaited<ReturnType<typeof studioApi.audit>>['events'][number];

function Card({ icon, title, children, right }: { icon: React.ReactNode; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="mb-3 flex items-center gap-2">{icon}<p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p><div className="ml-auto">{right}</div></div>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-xs" style={{ color: C.text }}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint ? <span className="block text-[11px]" style={{ color: C.faint }}>{hint}</span> : null}</span>
    </label>
  );
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<WsData | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [name, setName] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [audit, setAudit] = useState<AuditEv[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [invite, setInvite] = useState<{ email: string; role: Role }>({ email: '', role: 'editor' });
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await studioApi.workspace(id);
      setData(d); setSettings(d.workspace.settings); setName(d.workspace.name);
      if (d.role === 'owner' || d.role === 'admin') {
        studioApi.audit(id).then((r) => setAudit(r.events)).catch(() => {});
        studioApi.consents(id).then((r) => setConsents(r.consents)).catch(() => {});
      }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (data && (data.role === 'owner' || data.role === 'admin')) studioApi.usage(id, month).then(setUsage).catch(() => setUsage(null)); }, [id, month, data]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  if (!data || !settings) return <div className="flex h-64 items-center justify-center" style={{ color: C.muted }}>{msg ? msg.text : <Loader2 className="h-5 w-5 animate-spin" />}</div>;
  const admin = data.role === 'owner' || data.role === 'admin';
  const set = (patch: Partial<WorkspaceSettings>) => setSettings((s) => ({ ...(s as WorkspaceSettings), ...patch }));
  const numOrNull = (v: string) => (v.trim() ? Math.max(1, Math.floor(Number(v))) : null);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-8 py-10">
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/studio?workspace=${id}`} style={{ color: C.muted }}><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-2xl" style={{ color: C.text, letterSpacing: '-0.02em' }}>{data.workspace.name}</h1>
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: C.card, color: C.muted }}>{data.role}</span>
        {!admin ? (
          <button type="button" className="ml-auto text-xs underline" style={{ color: '#FCA5A5' }} onClick={() => run(async () => { const me = data.members.find((m) => m.role === data.role); if (me) await studioApi.removeMember(id, me.user_id); }, 'You left the workspace.')}>Leave workspace</button>
        ) : null}
      </div>
      {msg ? <div className="rounded-xl px-4 py-2 text-sm" style={{ background: msg.ok ? 'rgba(52,211,153,0.08)' : 'rgba(255,79,79,0.08)', color: msg.ok ? '#6EE7B7' : '#FCA5A5' }}>{msg.text}</div> : null}

      <Card icon={<Users className="h-4 w-4" style={{ color: C.accent }} />} title={`Members · ${data.members.length}`}>
        <div className="space-y-1.5">
          {data.members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-2 text-xs" style={{ color: C.text }}>
              <span className="flex-1 truncate">{m.email ?? m.user_id}</span>
              {admin && m.role !== 'owner' ? (
                <>
                  <Select value={m.role} onChange={(e) => run(() => studioApi.setRole(id, m.user_id, e.target.value as Role), 'Role updated.')} style={{ width: 120 }}>
                    {(['admin', 'editor', 'reviewer', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
                    {data.role === 'owner' ? <option value="owner">owner (transfer)</option> : null}
                  </Select>
                  <button type="button" style={{ color: '#FCA5A5' }} onClick={() => confirm(`Remove ${m.email}?`) && run(() => studioApi.removeMember(id, m.user_id), 'Member removed.')}><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              ) : <span style={{ color: C.muted }}>{m.role}</span>}
            </div>
          ))}
        </div>
        {admin ? (
          <div className="mt-4 space-y-2 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <div className="flex gap-2">
              <Input placeholder="colleague@company.com" value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} />
              <Select value={invite.role} onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value as Role }))} style={{ width: 130 }}>
                {(['editor', 'reviewer', 'viewer', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
              <Btn small primary disabled={!/\S+@\S+\.\S+/.test(invite.email)} onClick={() => run(async () => {
                const r = await studioApi.invite(id, invite);
                setLastLink(`${location.origin}/dashboard/studio/invite/${r.invite.token}`);
                setInvite({ email: '', role: invite.role });
              }, 'Invite created — share the link below.')}>Invite</Btn>
            </div>
            {lastLink ? (
              <div className="flex items-center gap-2 rounded-lg p-2 text-[11px]" style={{ background: C.bg, color: C.text }}>
                <code className="flex-1 truncate">{lastLink}</code>
                <button type="button" onClick={() => navigator.clipboard.writeText(lastLink)} style={{ color: C.muted }}><Copy className="h-3.5 w-3.5" /></button>
              </div>
            ) : null}
            {data.invites.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
                Pending: {i.email} · {i.role}
                <button type="button" className="underline" onClick={() => navigator.clipboard.writeText(`${location.origin}/dashboard/studio/invite/${i.token}`)}>copy link</button>
                <button type="button" style={{ color: '#FCA5A5' }} onClick={() => run(() => studioApi.deleteInvite(id, i.id), 'Invite revoked.')}>revoke</button>
              </div>
            ))}
            <p className="text-[11px]" style={{ color: C.faint }}>Roles — editor: edit, voice & render · reviewer: comment & approve · viewer: watch only · admin: everything incl. settings.</p>
          </div>
        ) : null}
      </Card>

      {admin && data.provider_key ? (
        <Card icon={<KeyRound className="h-4 w-4" style={{ color: C.accent }} />} title="Shared ElevenLabs account">
          <p className="mb-2 text-xs" style={{ color: C.muted }}>Everyone in the workspace can narrate with this account&rsquo;s voices (incl. your team&rsquo;s professional voice clones). Generations use your ElevenLabs quota, not Vantly credits. The key is encrypted and never shown again.</p>
          {data.provider_key.elevenlabs.configured ? (
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: C.text }}>Connected · key ending <code>…{data.provider_key.elevenlabs.last4}</code>
              <button type="button" className="ml-auto text-[11px]" style={{ color: '#FCA5A5' }} onClick={() => run(() => studioApi.deleteWorkspaceKey(id), 'Shared key removed.')}>Remove</button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Input type="password" placeholder={data.provider_key.elevenlabs.configured ? 'Replace with a new key' : 'sk_…'} value={key} onChange={(e) => setKey(e.target.value)} />
            <Btn small primary disabled={key.trim().length < 20} onClick={() => run(async () => { await studioApi.saveWorkspaceKey(id, key.trim()); setKey(''); }, 'Shared key saved.')}>Verify & save</Btn>
          </div>
        </Card>
      ) : null}

      {admin ? (
        <Card icon={<ShieldCheck className="h-4 w-4" style={{ color: C.accent }} />} title="Policies"
          right={<Btn small primary disabled={saving} onClick={async () => { setSaving(true); await run(() => studioApi.patchWorkspace(id, { name, settings }), 'Policies saved.'); setSaving(false); }}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save</Btn>}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Toggle label="Require approval before final renders" hint="Drafts (720p) are always allowed. Editing an approved project sends it back to review." checked={settings.require_approval} onChange={(v) => set({ require_approval: v })} />
              <Toggle label="Require recorded consent for cloned voices" hint="Speaker name, statement and optional evidence; referenced in every export's provenance manifest." checked={settings.require_voice_consent} onChange={(v) => set({ require_voice_consent: v })} />
              <Toggle label="“AI-generated voice” badge on new projects" checked={settings.disclosure_badge} onChange={(v) => set({ disclosure_badge: v })} />
            </div>
            <div className="space-y-3">
              <Field label="SSO domain" hint="Supabase SAML provider"><Input placeholder="company.com" value={settings.sso_domain ?? ''} onChange={(e) => set({ sso_domain: e.target.value.trim() || null })} /></Field>
              <Toggle label="Enforce SSO" hint="Members must sign in with company SSO; invites limited to the SSO domain." checked={settings.enforce_sso} onChange={(v) => set({ enforce_sso: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Monthly budget (credits)"><Input type="number" min={1} placeholder="unlimited" value={settings.monthly_credit_budget ?? ''} onChange={(e) => set({ monthly_credit_budget: numOrNull(e.target.value) })} /></Field>
                <Field label="Per-member cap"><Input type="number" min={1} placeholder="unlimited" value={settings.member_monthly_cap ?? ''} onChange={(e) => set({ member_monthly_cap: numOrNull(e.target.value) })} /></Field>
                <Field label="Delete recordings after (days)"><Input type="number" min={1} placeholder="keep" value={settings.retention_days ?? ''} onChange={(e) => set({ retention_days: numOrNull(e.target.value) })} /></Field>
                <Field label="Data region"><Select value={settings.data_region} onChange={(e) => set({ data_region: e.target.value })}>{data.regions.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
              </div>
              <Field label="Render webhook" hint="POSTed when renders finish (HMAC-signed)"><Input placeholder="https://…" value={settings.webhook_url ?? ''} onChange={(e) => set({ webhook_url: e.target.value.trim() || null })} /></Field>
            </div>
          </div>
        </Card>
      ) : null}

      {admin ? (
        <Card icon={<Wallet className="h-4 w-4" style={{ color: C.accent }} />} title="Usage"
          right={<div className="flex items-center gap-2"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 150 }} /><a href={studioApi.usageCsvUrl(id, month)} className="inline-flex items-center gap-1 text-xs underline" style={{ color: C.muted }}><Download className="h-3.5 w-3.5" /> CSV</a></div>}>
          {!usage ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: C.muted }} /> : (
            <>
              <p className="mb-3 text-xs" style={{ color: C.muted }}>{usage.spent} credits spent{usage.budget ? ` of ${usage.budget}` : ''} in {usage.month}.</p>
              {usage.budget ? <div className="mb-4 h-1.5 overflow-hidden rounded-full" style={{ background: C.bg }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, (usage.spent / usage.budget) * 100)}%`, background: usage.spent > usage.budget * 0.9 ? '#F87171' : C.accent }} /></div> : null}
              {(['members', 'projects'] as const).map((k) => (
                <table key={k} className="mb-4 w-full text-xs">
                  <thead><tr style={{ color: C.faint }}><th className="py-1 text-left font-medium">{k === 'members' ? 'Member' : 'Project'}</th><th className="text-right font-medium">Voice chars</th><th className="text-right font-medium">Renders</th><th className="text-right font-medium">Minutes</th><th className="text-right font-medium">Credits</th></tr></thead>
                  <tbody>
                    {(k === 'members' ? usage.members.map((r) => ({ name: r.email ?? r.user_id, ...r })) : usage.projects.map((r) => ({ name: r.title, ...r }))).map((r) => (
                      <tr key={r.name} style={{ color: C.text, borderTop: `1px solid ${C.line}` }}><td className="truncate py-1">{r.name}</td><td className="text-right">{r.tts_chars.toLocaleString()}</td><td className="text-right">{r.renders}</td><td className="text-right">{r.render_minutes.toFixed(1)}</td><td className="text-right">{r.total_credits}</td></tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </>
          )}
        </Card>
      ) : null}

      {admin ? (
        <Card icon={<ShieldCheck className="h-4 w-4" style={{ color: C.accent }} />} title={`Voice consents · ${consents.filter((c) => !c.revoked_at).length}`}>
          {!consents.length ? <p className="text-xs" style={{ color: C.faint }}>None yet. They&rsquo;re recorded the first time someone uses a cloned voice.</p> : consents.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1 text-xs" style={{ color: c.revoked_at ? C.faint : C.text }}>
              <b>{c.voice_name || c.voice_id}</b> — {c.speaker_name} · by {c.attested_by_email} · {new Date(c.attested_at).toLocaleDateString()}
              {c.evidence_url ? <a href={c.evidence_url} target="_blank" rel="noreferrer" className="underline" style={{ color: C.muted }}>evidence</a> : null}
              {c.revoked_at ? <span className="ml-auto">revoked</span> : <button type="button" className="ml-auto" style={{ color: '#FCA5A5' }} onClick={() => confirm('Revoke this consent? The voice will be blocked until consent is recorded again.') && run(() => studioApi.revokeConsent(c.id), 'Consent revoked.')}>Revoke</button>}
            </div>
          ))}
        </Card>
      ) : null}

      {admin ? (
        <Card icon={<ScrollText className="h-4 w-4" style={{ color: C.accent }} />} title="Audit log">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${C.line}`, color: C.text }}>
                    <td className="whitespace-nowrap py-1 pr-3" style={{ color: C.faint }}>{new Date(e.created_at).toLocaleString()}</td>
                    <td className="pr-3">{e.user_email ?? 'system'}</td>
                    <td className="pr-3 font-mono">{e.action}</td>
                    <td className="truncate" style={{ color: C.muted }}>{JSON.stringify(Object.fromEntries(Object.entries(e.detail).filter(([k]) => k !== 'ip')))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!audit.length ? <p className="text-xs" style={{ color: C.faint }}>No events yet.</p> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
