// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Output (frame, fill, quality, batch shapes), render with live progress,
 * per-shape downloads + provenance manifest, publish / schedule to social via
 * Vantly, and one-click localization into another language.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Download, FileCheck2, Globe2, Loader2, Rocket, Send, ShieldAlert } from 'lucide-react';
import { ASPECTS, renderAspects, validateVoiceoverForRender, type VoiceoverAspect, type VoiceoverOutput, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { NetworkLogo } from '@/components/brand-icons';
import { studioApi, StudioApiError, type RenderStatus, type ReviewStatus, type StudioSource, type VoicesResponse } from '../_lib/api';
import { Btn, C, Field, Input, Seg, Select, Slider } from './ui';

const STAGES: Record<string, string> = {
  downloading: 'Fetching your recording', cutting: 'Cutting, speeding & zooming clips', transitions: 'Adding transitions',
  rendering: 'Adding voice, text, effects & captions', uploading: 'Uploading', done: 'Done',
};
const ASPECT_LABEL: Record<VoiceoverAspect, string> = { source: 'Original', '16:9': '16:9 YouTube', '9:16': '9:16 Shorts/Reels', '1:1': '1:1 Feed' };
const LANGUAGES: Array<[string, string]> = [['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['ta', 'Tamil'], ['te', 'Telugu'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['id', 'Indonesian'], ['it', 'Italian'], ['ru', 'Russian'], ['tr', 'Turkish'], ['nl', 'Dutch'], ['pl', 'Polish'], ['vi', 'Vietnamese']];

export function ExportPanel(p: {
  projectId: string;
  source: StudioSource;
  timeline: VoiceoverTimeline;
  lastRunId: string | null;
  reviewStatus: ReviewStatus;
  requireApproval: boolean;
  canRender: boolean;
  voices: VoicesResponse | null;
  language: string | null;
  onOutputChange: (patch: Partial<VoiceoverOutput>) => void;
  beforeRender: () => Promise<void>;
}) {
  const out = p.timeline.output;
  const [quote, setQuote] = useState<{ credits: number; output_seconds: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(p.lastRunId);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [notify, setNotify] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const problems = validateVoiceoverForRender({ project_id: p.projectId, source: p.source, timeline: p.timeline, provenance: { title: '', voices: [], workspace_id: null, approved_by: null }, storage_region: null, webhook_url: null, notify_email: null });
  const finalBlocked = p.requireApproval && p.reviewStatus !== 'approved' && out.quality !== 'draft';
  const aspects = renderAspects(out);

  useEffect(() => {
    if (problems.length) { setQuote(null); return; }
    const h = setTimeout(() => { studioApi.quote(p.projectId).then(setQuote).catch(() => setQuote(null)); }, 1500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projectId, p.timeline]);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await studioApi.renderStatus(runId);
        if (stop) return;
        setStatus(s);
        if (s.status === 'submitted' || s.status === 'running') timer.current = setTimeout(poll, 2500);
      } catch { if (!stop) timer.current = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [runId]);

  async function render() {
    setStarting(true); setError(null);
    try {
      await p.beforeRender();
      const r = await studioApi.render(p.projectId, notify ? {} : { notify_email: null });
      setStatus(null); setRunId(r.run_id);
    } catch (e) { const err = e as StudioApiError; setError({ code: err.code, message: err.message }); } finally { setStarting(false); }
  }

  const busy = status?.status === 'submitted' || status?.status === 'running';
  const pct = Math.round((status?.progress?.pct ?? (status?.status === 'submitted' ? 0.01 : 0)) * 100);

  return (
    <div className="space-y-4 p-3">
      <Field label="Frame">
        <Seg value={out.aspect} onChange={(aspect) => p.onOutputChange({ aspect, extra_aspects: out.extra_aspects.filter((a) => a !== aspect) })}
          options={[{ value: 'source', label: `Original` }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }]} />
      </Field>
      <Field label="Also export (batch)">
        <div className="flex flex-wrap gap-2 text-[11px]" style={{ color: C.text }}>
          {ASPECTS.filter((a) => a !== out.aspect).map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input type="checkbox" checked={out.extra_aspects.includes(a)} onChange={(e) => p.onOutputChange({ extra_aspects: e.target.checked ? [...out.extra_aspects, a] : out.extra_aspects.filter((x) => x !== a) })} /> {ASPECT_LABEL[a]}
            </label>
          ))}
        </div>
      </Field>
      {aspects.some((a) => a !== 'source') ? (
        <Field label="Fill (other shapes)">
          <Seg value={out.fit} onChange={(fit) => p.onOutputChange({ fit })} options={[{ value: 'blur', label: 'Blurred' }, { value: 'black', label: 'Black bars' }, { value: 'cover', label: 'Crop' }]} />
        </Field>
      ) : null}
      <Field label="Quality">
        <Seg value={out.quality} onChange={(quality) => p.onOutputChange({ quality })}
          options={[{ value: 'draft', label: 'Draft 720p' }, { value: 'standard', label: '1080p' }, { value: 'high', label: 'High (to 4K)' }]} />
      </Field>
      <Slider label="Original recording audio" hint={p.source.has_audio ? undefined : 'screen captures are usually silent'} min={0} max={1.5} step={0.05} value={out.original_volume}
        fmt={(v) => (v === 0 ? 'muted' : `${Math.round(v * 100)}%`)} onChange={(v) => p.onOutputChange({ original_volume: v })} />

      {problems.length ? (
        <div className="space-y-1 rounded-lg p-2 text-[11px]" style={{ background: 'rgba(252,211,77,0.08)', color: '#FCD34D' }}>
          {problems.map((pr) => <div key={pr} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {pr}</div>)}
        </div>
      ) : null}
      {finalBlocked ? (
        <div className="flex gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: 'rgba(167,139,250,0.08)', color: '#C9B8FF' }}>
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Your workspace requires approval before a final render. Render a Draft, or submit for review in the Review tab.
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email me when it&rsquo;s ready</label>
      <Btn primary disabled={!p.canRender || starting || busy || problems.length > 0 || finalBlocked} onClick={render}>
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Render {aspects.length > 1 ? `${aspects.length} videos` : 'video'}{quote ? ` · ${quote.credits ? `${quote.credits} credits` : 'free'}` : ''}
      </Btn>
      {error ? <div className="text-xs" style={{ color: '#FCA5A5' }}>{error.message} {error.code === 'INSUFFICIENT_CREDITS' ? <Link className="underline" href="/dashboard/billing">Top up</Link> : null}</div> : null}

      {status && busy ? (
        <div>
          <div className="mb-1 flex text-[11px]" style={{ color: C.muted }}><span>{STAGES[status.progress?.stage ?? ''] ?? 'Queued'}</span><span className="ml-auto font-mono">{pct}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.bg }}><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, pct)}%`, background: C.accent }} /></div>
          <p className="mt-1 text-[10px]" style={{ color: C.faint }}>You can close this tab — the render keeps going{notify ? ' and we’ll email you' : ''}.</p>
        </div>
      ) : null}
      {status?.status === 'failed' ? <div className="rounded-lg p-2 text-xs" style={{ background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>Render failed{status.error?.message ? `: ${status.error.message}` : ''}. Any credits were refunded.</div> : null}

      {status?.status === 'succeeded' && status.videos.length ? (
        <div className="space-y-2">
          <video src={status.videos[0].url} controls className="w-full rounded-lg" style={{ background: '#000' }} />
          <div className="space-y-1">
            {status.videos.map((v) => (
              <a key={v.aspect} href={v.url} download target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs" style={{ border: `1px solid ${C.line2}`, color: C.text }}>
                <Download className="h-3.5 w-3.5" /> {ASPECT_LABEL[v.aspect as VoiceoverAspect] ?? v.aspect}{v.width ? ` · ${v.width}×${v.height}` : ''}
              </a>
            ))}
            {status.manifest_url ? <a href={status.manifest_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] underline" style={{ color: C.muted }}><FileCheck2 className="h-3.5 w-3.5" /> Provenance manifest (AI disclosure){status.c2pa_url ? ' · C2PA-signed copy available' : ''}</a> : null}
            <Link href="/dashboard/gallery" className="text-[11px] underline" style={{ color: C.muted }}>In your Gallery</Link>
          </div>
          <PublishBox videos={status.videos} />
        </div>
      ) : null}

      <LocalizeBox projectId={p.projectId} voices={p.voices} current={p.language} onBeforeLocalize={p.beforeRender} />
    </div>
  );
}

interface Channel { id: string; name: string; provider: string }

function PublishBox({ videos }: { videos: RenderStatus['videos'] }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [video, setVideo] = useState(videos[0]?.url ?? '');
  const [caption, setCaption] = useState('');
  const [when, setWhen] = useState<'now' | 'schedule'>('now');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetch('/api/v1/social/channels', { credentials: 'include' }).then((r) => r.json()).then((j) => setChannels(j.channels ?? [])).catch(() => setChannels([])); }, []);
  return (
    <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.text }}><Send className="h-3.5 w-3.5" /> Publish via Vantly</p>
      {channels === null ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: C.muted }} /> : !channels.length ? (
        <p className="text-[11px]" style={{ color: C.muted }}>No social channels connected. <Link className="underline" href="/dashboard/social">Connect one</Link>.</p>
      ) : (
        <>
          {videos.length > 1 ? <Select value={video} onChange={(e) => setVideo(e.target.value)}>{videos.map((v) => <option key={v.aspect} value={v.url}>{ASPECT_LABEL[v.aspect as VoiceoverAspect] ?? v.aspect}</option>)}</Select> : null}
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c) => (
              <label key={c.id} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px]" style={{ border: `1px solid ${picked.includes(c.id) ? C.accent : C.line2}`, color: C.text }}>
                <input type="checkbox" className="hidden" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                <NetworkLogo provider={c.provider} size={14} /> {c.name}
              </label>
            ))}
          </div>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="Caption / post text" className="w-full rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.line2}` }} />
          <div className="flex items-center gap-2">
            <Seg value={when} onChange={setWhen} options={[{ value: 'now', label: 'Post now' }, { value: 'schedule', label: 'Schedule' }]} />
            {when === 'schedule' ? <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /> : null}
          </div>
          <Btn small primary disabled={busy || !picked.length || (when === 'schedule' && !date)} onClick={async () => {
            setBusy(true); setMsg(null);
            try {
              const r = await fetch('/api/v1/social/publish', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_url: video, channel_ids: picked, caption, type: when, ...(when === 'schedule' ? { date: new Date(date).toISOString() } : {}) }),
              });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j?.error?.message ?? j?.error ?? `Publish failed (${r.status})`);
              setMsg(when === 'schedule' ? `Scheduled for ${new Date(date).toLocaleString()}.` : 'Sent to Vantly — it will appear on your channels shortly.');
            } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : when === 'schedule' ? <CalendarClock className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} {when === 'schedule' ? 'Schedule' : 'Publish'}</Btn>
          {msg ? <p className="text-[11px]" style={{ color: C.muted }}>{msg}</p> : null}
        </>
      )}
    </div>
  );
}

function LocalizeBox({ projectId, voices, current, onBeforeLocalize }: { projectId: string; voices: VoicesResponse | null; current: string | null; onBeforeLocalize: () => Promise<void> }) {
  const router = useRouter();
  const [lang, setLang] = useState('hi');
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groups = [
    ...(voices?.user.voices.map((v) => ({ v, s: 'user' as const })) ?? []),
    ...(voices?.workspace?.voices.map((v) => ({ v, s: 'workspace' as const })) ?? []),
    ...(voices?.platform.voices.map((v) => ({ v, s: 'platform' as const })) ?? []),
  ];
  return (
    <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.text }}><Globe2 className="h-3.5 w-3.5" /> Translate this video</p>
      <p className="text-[10px]" style={{ color: C.faint }}>Creates a copy with translated narration, text and cards — same recording, same edit — ready to voice. Your cloned voice speaks every language with ElevenLabs Multilingual.</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGUAGES.filter(([c]) => c !== current).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>
        <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="">Keep current voice</option>
          {groups.map(({ v, s }) => <option key={`${s}:${v.voice_id}`} value={`${s}:${v.voice_id}`}>{v.name}</option>)}
        </Select>
      </div>
      <Btn small disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          await onBeforeLocalize();
          const [src, vid] = voice ? voice.split(':') : [undefined, undefined];
          const name = LANGUAGES.find(([c]) => c === lang)?.[1] ?? lang;
          const vname = groups.find((g) => g.v.voice_id === vid)?.v.name;
          const r = await studioApi.localize(projectId, { language: lang, language_name: name, ...(vid ? { voice_id: vid, voice_source: src as 'user', voice_name: vname } : {}) });
          router.push(`/dashboard/studio/${r.project.id}?autogen=1`);
        } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="h-3.5 w-3.5" />} Translate & open</Btn>
      {err ? <p className="text-[11px]" style={{ color: '#FCA5A5' }}>{err}</p> : null}
    </div>
  );
}
