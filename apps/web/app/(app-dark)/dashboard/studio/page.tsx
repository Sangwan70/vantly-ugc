// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/studio — Voiceover Studio home: personal and team workspaces,
 * projects grouped by series, uploads straight to storage (up to 5 GB, with
 * progress) with an optional template, workspace invites, and the automation
 * API for hands-free videos.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clapperboard, Code2, Globe2, Loader2, Plus, Settings, Trash2, Upload, Users } from 'lucide-react';
import { studioApi, uploadDirect, type Role, type StudioProject, type Template, type WorkspaceSettings } from './_lib/api';
import { fmtTime } from './_lib/ops';
import { Btn, C, Input, Select } from './_components/ui';

function readVideoMeta(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      const meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      URL.revokeObjectURL(url);
      if (!meta.duration || !Number.isFinite(meta.duration) || !meta.width) reject(new Error('Could not read this video. Export it as MP4 (H.264) and try again.'));
      else resolve(meta);
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser cannot read that video. Export it as MP4 (H.264).')); };
    v.src = url;
  });
}

const REVIEW_COLOR: Record<string, string> = { draft: C.faint, in_review: '#FCD34D', changes_requested: '#FCA5A5', approved: '#6EE7B7' };

export default function StudioPage() {
  // useSearchParams needs a Suspense boundary for prerendering (Next 15).
  return <Suspense fallback={null}><StudioPageInner /></Suspense>;
}

function StudioPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; role: Role; settings: WorkspaceSettings }>>([]);
  const [invites, setInvites] = useState<Array<{ token: string; role: Role; workspace: { id: string; name: string } }>>([]);
  const [ws, setWs] = useState<string | null>(search.get('workspace'));
  const [projects, setProjects] = useState<StudioProject[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [series, setSeries] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number; stage: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [newWs, setNewWs] = useState('');
  const [showApi, setShowApi] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadWs = useCallback(() => studioApi.workspaces().then((r) => { setWorkspaces(r.workspaces); setInvites(r.invites); }).catch(() => {}), []);
  useEffect(() => { void loadWs(); studioApi.templates().then((r) => setTemplates(r.templates)).catch(() => {}); }, [loadWs]);
  useEffect(() => {
    setProjects(null);
    studioApi.listProjects({ workspace_id: ws }).then((r) => setProjects(r.projects)).catch((e: Error) => { setError(e.message); setProjects([]); });
  }, [ws]);

  const current = workspaces.find((w) => w.id === ws) ?? null;
  const canCreate = !current || ['owner', 'admin', 'editor'].includes(current.role);
  const bySeries = useMemo(() => {
    const m = new Map<string, StudioProject[]>();
    for (const p of projects ?? []) { const k = p.series ?? ''; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [projects]);
  const knownSeries = useMemo(() => [...new Set((projects ?? []).map((p) => p.series).filter(Boolean))] as string[], [projects]);

  async function start(file: File) {
    setError(null);
    if (!/^video\/(mp4|quicktime|webm|x-m4v)$/.test(file.type)) { setError('Upload an MP4, MOV or WebM screen recording.'); return; }
    if (file.size > 5 * 1024 ** 3) { setError('That file is over 5 GB. Export a shorter range or a lower bitrate.'); return; }
    abortRef.current = new AbortController();
    setUpload({ name: file.name, pct: 0, stage: 'Reading video' });
    try {
      const meta = await readVideoMeta(file);
      setUpload({ name: file.name, pct: 0, stage: 'Uploading' });
      const url = await uploadDirect(file, { workspaceId: ws, signal: abortRef.current.signal, onProgress: (pct) => setUpload({ name: file.name, pct, stage: 'Uploading' }) });
      setUpload({ name: file.name, pct: 1, stage: 'Preparing editor' });
      const { project } = await studioApi.createProject({
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled voiceover',
        source_url: url, ...meta, workspace_id: ws, template_id: templateId || null, series: series.trim() || null,
      });
      router.push(`/dashboard/studio/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setUpload(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this project? Rendered videos stay in your Gallery.')) return;
    try { await studioApi.deleteProject(id); setProjects((p) => (p ?? []).filter((x) => x.id !== id)); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="flex items-start gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.faint }}>Voiceover Studio</p>
          <h1 className="mt-2 font-normal" style={{ color: C.text, fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>Your screen recording, your voice.</h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: C.muted }}>
            Drop in a silent capture from Filmora, OBS or any recorder. We find the clicks, dead air and scene changes for you; you cut, zoom, add effects and branded titles, and narrate every scene with ElevenLabs — your own cloned voice or ours — in any language.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Select value={ws ?? ''} onChange={(e) => setWs(e.target.value || null)} style={{ width: 200 }}>
            <option value="">Personal</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}
          </Select>
          {current && ['owner', 'admin'].includes(current.role) ? <Link href={`/dashboard/studio/workspaces/${current.id}`} className="rounded-lg p-2" style={{ border: `1px solid ${C.line2}`, color: C.text }} title="Workspace settings"><Settings className="h-4 w-4" /></Link> : null}
        </div>
      </div>

      {invites.length ? (
        <div className="mt-6 space-y-2">
          {invites.map((i) => (
            <div key={i.token} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', color: C.text }}>
              <Users className="h-4 w-4" style={{ color: C.accent }} /> You&rsquo;re invited to <b>{i.workspace.name}</b> as {i.role}.
              <Btn small primary onClick={async () => { try { const r = await studioApi.acceptInvite(i.token); await loadWs(); setWs(r.workspace_id); } catch (e) { setError((e as Error).message); } }}>Join</Btn>
            </div>
          ))}
        </div>
      ) : null}

      {canCreate ? (
        <>
          <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f && !upload) void start(f); }}
            onClick={() => !upload && fileRef.current?.click()}
            className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl px-6 py-10 text-center transition-colors"
            style={{ border: `1.5px dashed ${dragOver ? C.accent : C.line2}`, background: dragOver ? 'rgba(167,139,250,0.06)' : C.card }}>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); e.target.value = ''; }} />
            {upload ? (
              <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <p className="truncate text-sm" style={{ color: C.text }}>{upload.name}</p>
                <p className="mt-1 text-xs" style={{ color: C.muted }}>{upload.stage}{upload.stage === 'Uploading' ? ` · ${Math.round(upload.pct * 100)}%` : '…'}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: C.bg }}><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, upload.pct * 100)}%`, background: C.accent }} /></div>
                {upload.stage === 'Uploading' ? <button type="button" className="mt-2 text-[11px] underline" style={{ color: C.muted }} onClick={() => { abortRef.current?.abort(); setUpload(null); }}>Cancel</button> : null}
              </div>
            ) : (
              <>
                <Upload className="h-6 w-6" style={{ color: C.accent }} />
                <p className="mt-3 text-sm font-medium" style={{ color: C.text }}>Drop a screen recording, or click to choose</p>
                <p className="mt-1 text-xs" style={{ color: C.faint }}>MP4 / MOV / WebM · up to 5 GB · no voice or captions needed{current ? ` · saved to ${current.name}` : ''}</p>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: C.muted }}>
            <span>Start from</span>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: 240 }}>
              <option value="">No template</option>
              {templates.filter((t) => !t.workspace_id || t.workspace_id === ws).map((t) => <option key={t.id} value={t.id}>{t.name}{t.workspace_id ? ' · team' : ''}</option>)}
            </Select>
            <span className="ml-2">Series</span>
            <Input list="studio-series" value={series} onChange={(e) => setSeries(e.target.value)} placeholder="e.g. T1 How TheSkillPedia Works" style={{ width: 260 }} />
            <datalist id="studio-series">{knownSeries.map((s) => <option key={s} value={s} />)}</datalist>
            <button type="button" className="ml-auto inline-flex items-center gap-1 underline" onClick={() => setShowApi((v) => !v)}><Code2 className="h-3.5 w-3.5" /> Automate via API</button>
          </div>
        </>
      ) : <p className="mt-8 text-sm" style={{ color: C.muted }}>You have {current?.role} access in {current?.name}.</p>}

      {showApi ? (
        <pre className="mt-3 overflow-x-auto rounded-xl p-4 text-[11px] leading-relaxed" style={{ background: C.card, color: C.text, border: `1px solid ${C.line}` }}>{`# Recording + script → finished, narrated video(s). Auth: Authorization: Bearer ma_… (API Keys page)
curl -X POST https://api.vantly-ugc.com/v1/studio/automate \\
  -H "Authorization: Bearer $VANTLY_KEY" -H "Content-Type: application/json" -d '{
    "source_url": "https://…/VID_20261123_181018.mp4",
    "script": "CUE 1 | start 0:00.0 | max 17.1s\\nWhat if you could watch a course before paying…",
    "voice_id": "<your ElevenLabs voice id>", "voice_source": "user",
    "aspects": ["16:9", "9:16"], "captions": "minimal", "apply": ["cut","speed","focus","click"],
    ${ws ? `"workspace_id": "${ws}", ` : ''}${templateId ? `"template_id": "${templateId}", ` : ''}"webhook_url": "https://example.com/hooks/vantly"
  }'
# → { "project_id": "…", "run_id": "…", "status_url": "/v1/studio/renders/<run_id>" }
# Webhook body: { event: "voiceover.render.finished", status, videos: [{ aspect, url }], manifest_url }
#   signed with X-Vantly-Signature: sha256=HMAC(body, STUDIO_WEBHOOK_SECRET)`}</pre>
      ) : null}

      {error ? <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{error}</div> : null}

      <section className="mt-10 space-y-8">
        {projects === null ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: C.muted }} /> : projects.length === 0 ? <p className="text-sm" style={{ color: C.faint }}>No projects yet.</p> : bySeries.map(([name, list]) => (
          <div key={name || '_'}>
            <p className="mb-3 text-xs font-semibold" style={{ color: C.muted }}>{name || (bySeries.length > 1 ? 'Other projects' : 'Projects')} <span style={{ color: C.faint }}>· {list.length}</span></p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((pr) => (
                <div key={pr.id} className="group overflow-hidden rounded-2xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                  <Link href={`/dashboard/studio/${pr.id}`} className="block">
                    <div className="relative aspect-video" style={{ background: '#000' }}>
                      {pr.source?.url ? <video src={`${pr.source.proxy_url ?? pr.source.url}#t=1`} muted preload="metadata" className="h-full w-full object-contain" /> : <Clapperboard className="m-auto h-6 w-6" />}
                      <div className="absolute left-2 top-2 flex gap-1">
                        {pr.language ? <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Globe2 className="h-3 w-3" />{pr.language}</span> : null}
                        {pr.workspace_id ? <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'rgba(0,0,0,0.6)', color: REVIEW_COLOR[pr.review_status] }}>{pr.review_status.replace('_', ' ')}</span> : null}
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-sm" style={{ color: C.text }}>{pr.title}</p>
                      <p className="text-[11px]" style={{ color: C.faint }}>
                        {pr.source ? `${fmtTime(pr.source.duration, false)} · ${pr.source.width}×${pr.source.height} · ` : ''}edited {new Date(pr.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {pr.automation?.status ? ` · auto: ${pr.automation.status}` : ''}
                      </p>
                    </div>
                  </Link>
                  <div className="flex justify-end px-3 pb-2">
                    <button type="button" onClick={() => remove(pr.id)} className="inline-flex items-center gap-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100" style={{ color: '#FCA5A5' }}><Trash2 className="h-3 w-3" /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-12 rounded-2xl p-4" style={{ border: `1px solid ${C.line}` }}>
        <p className="text-xs font-semibold" style={{ color: C.text }}>Team workspaces</p>
        <p className="mt-1 text-xs" style={{ color: C.muted }}>Shared projects, one shared ElevenLabs account and cloned voices, review &amp; approval, budgets, audit log, SSO.</p>
        <div className="mt-3 flex gap-2">
          <Input placeholder="Workspace name (e.g. TheSkillPedia Content)" value={newWs} onChange={(e) => setNewWs(e.target.value)} style={{ maxWidth: 320 }} />
          <Btn small primary disabled={newWs.trim().length < 2} onClick={async () => {
            try { const r = await studioApi.createWorkspace(newWs.trim()); setNewWs(''); await loadWs(); router.push(`/dashboard/studio/workspaces/${r.workspace.id}`); } catch (e) { setError((e as Error).message); }
          }}><Plus className="h-3.5 w-3.5" /> Create workspace</Btn>
        </div>
      </section>
    </div>
  );
}
