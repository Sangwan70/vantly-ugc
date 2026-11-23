// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Output format, captions, render (Temporal job) with live progress, download and publish. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download, Loader2, Rocket } from 'lucide-react';
import { validateVoiceoverForRender, type VoiceoverOutput, type VoiceoverSource, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { PublishToSocial } from '@/components/publish-to-social';
import { studioApi, StudioApiError, type RenderStatus } from '../_lib/api';
import { Btn, C, Field, Seg, Slider } from './ui';

const STAGES: Record<string, string> = {
  downloading: 'Fetching your recording',
  cutting: 'Cutting, speeding & zooming clips',
  rendering: 'Adding voice, text & captions',
  uploading: 'Uploading',
  done: 'Done',
};

export function ExportPanel({ projectId, source, timeline, lastRunId, onOutputChange, beforeRender }: {
  projectId: string;
  source: VoiceoverSource;
  timeline: VoiceoverTimeline;
  lastRunId: string | null;
  onOutputChange: (patch: Partial<VoiceoverOutput>) => void;
  beforeRender: () => Promise<void>;
}) {
  const out = timeline.output;
  const [quote, setQuote] = useState<{ credits: number; output_seconds: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(lastRunId);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const problems = validateVoiceoverForRender({ project_id: projectId, source, timeline });

  useEffect(() => {
    if (problems.length) { setQuote(null); return; }
    const h = setTimeout(() => { studioApi.quote(projectId).then(setQuote).catch(() => setQuote(null)); }, 1500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, timeline]);

  // Poll the render.
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await studioApi.renderStatus(runId);
        if (stop) return;
        setStatus(s);
        if (s.status === 'submitted' || s.status === 'running') timer.current = setTimeout(poll, 2500);
      } catch {
        if (!stop) timer.current = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
  }, [runId]);

  async function render() {
    setStarting(true);
    setError(null);
    try {
      await beforeRender();
      const r = await studioApi.render(projectId);
      setStatus(null);
      setRunId(r.run_id);
    } catch (e) {
      const err = e as StudioApiError;
      setError({ code: err.code, message: err.message });
    } finally {
      setStarting(false);
    }
  }

  const busy = status?.status === 'submitted' || status?.status === 'running';
  const pct = Math.round((status?.progress?.pct ?? (status?.status === 'submitted' ? 0.01 : 0)) * 100);

  return (
    <div className="space-y-4 p-3">
      <Field label="Frame">
        <Seg value={out.aspect} onChange={(aspect) => onOutputChange({ aspect })}
          options={[{ value: 'source', label: `Original ${source.width}×${source.height}` }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }]} />
      </Field>
      {out.aspect !== 'source' ? (
        <Field label="Fill">
          <Seg value={out.fit} onChange={(fit) => onOutputChange({ fit })}
            options={[{ value: 'blur', label: 'Blurred background' }, { value: 'black', label: 'Black bars' }, { value: 'cover', label: 'Crop to fill' }]} />
        </Field>
      ) : null}

      <Field label="Captions" hint="timed from the generated voice">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={out.captions.enabled} onChange={(e) => onOutputChange({ captions: { ...out.captions, enabled: e.target.checked } })} />
          <div className="flex-1">
            <Seg value={out.captions.style} onChange={(style) => onOutputChange({ captions: { ...out.captions, style } })}
              options={[{ value: 'minimal', label: 'Minimal' }, { value: 'tiktok', label: 'Boxed' }, { value: 'hormozi', label: 'Bold karaoke' }]} />
          </div>
        </div>
      </Field>

      <Slider
        label="Original recording audio"
        hint={source.has_audio ? undefined : 'usually silent for screen captures'}
        min={0} max={1.5} step={0.05}
        value={out.original_volume}
        fmt={(v) => (v === 0 ? 'muted' : `${Math.round(v * 100)}%`)}
        onChange={(v) => onOutputChange({ original_volume: v })}
      />

      {problems.length ? (
        <div className="space-y-1 rounded-lg p-2 text-[11px]" style={{ background: 'rgba(252,211,77,0.08)', color: '#FCD34D' }}>
          {problems.map((pr) => <div key={pr} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {pr}</div>)}
        </div>
      ) : null}

      <Btn primary disabled={starting || busy || problems.length > 0} onClick={render}>
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Render video{quote ? ` · ${quote.credits ? `${quote.credits} credits` : 'free'}` : ''}
      </Btn>

      {error ? (
        <div className="text-xs" style={{ color: '#FCA5A5' }}>
          {error.message} {error.code === 'INSUFFICIENT_CREDITS' ? <Link className="underline" href="/dashboard/billing">Top up</Link> : null}
        </div>
      ) : null}

      {status && busy ? (
        <div>
          <div className="mb-1 flex text-[11px]" style={{ color: C.muted }}>
            <span>{STAGES[status.progress?.stage ?? ''] ?? 'Queued'}</span>
            <span className="ml-auto font-mono">{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.bg }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, pct)}%`, background: C.accent }} />
          </div>
        </div>
      ) : null}

      {status?.status === 'failed' ? (
        <div className="rounded-lg p-2 text-xs" style={{ background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          Render failed{status.error?.message ? `: ${status.error.message}` : ''}. Any credits were refunded.
        </div>
      ) : null}

      {status?.status === 'succeeded' && status.video_url ? (
        <div className="space-y-2">
          <video src={status.video_url} controls className="w-full rounded-lg" style={{ background: '#000' }} />
          <div className="flex flex-wrap items-center gap-2">
            <a href={status.video_url} download target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs" style={{ border: `1px solid ${C.line2}`, color: C.text }}>
              <Download className="h-3.5 w-3.5" /> Download MP4
            </a>
            <Link href="/dashboard/gallery" className="text-xs underline" style={{ color: C.muted }}>In your Gallery</Link>
          </div>
          <div className="rounded-lg p-2" style={{ background: C.bg }}>
            <p className="mb-1 text-[11px]" style={{ color: C.muted }}>Publish via Vantly</p>
            <PublishToSocial videoUrl={status.video_url} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
