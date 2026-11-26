// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/studio/[id] — Voiceover Studio editor.
 *
 *   ┌──────────── preview ────────────┬─ Script │ Edit │ Smart │ Style │ Review │ Export ─┐
 *   ├─────────── transport ───────────┤                                                  │
 *   ├──── timeline: Video / Voice / Text / Effects (+ suggestions & comments on ruler) ─┤
 *
 * Keys: Space play · S split · T text · V voice · E click effect · Del delete ·
 *       ←/→ 1s (Shift 5s) · ⌘Z / ⇧⌘Z undo/redo · Esc cancel
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Loader2, Mic, MessageSquare, Palette, Pause, Play, Redo2, Rocket, Scissors, SkipBack, SlidersHorizontal, Sparkles, Type, Undo2, Users, Wand2 } from 'lucide-react';
import { clipOutputDuration, timelineDuration, type VoiceoverEffect, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { useStudioProject } from '../_lib/use-project';
import { studioApi, type Comment, type VoicesResponse } from '../_lib/api';
import {
  clipStarts, deleteBlock, deleteClip, deleteEffect, deleteOverlay, fmtTime, moveClip, newBlock, newEffect, newOverlay, splitAt, updateClip, updateEffect, updateOverlay, upsertBlock,
} from '../_lib/ops';
import { Preview, type PickMode } from '../_components/preview';
import { Timeline, type Selection } from '../_components/timeline';
import { VoicePanel, loadVoiceDefaults } from '../_components/voice-panel';
import { ClipInspector, EffectInspector, OverlayInspector } from '../_components/inspector';
import { ExportPanel } from '../_components/export-panel';
import { StylePanel } from '../_components/style-panel';
import { ReviewPanel, SmartPanel } from '../_components/side-panels';
import { SettingsDialog } from '../_components/settings-dialog';
import { Btn, C } from '../_components/ui';

type Tab = 'script' | 'edit' | 'smart' | 'style' | 'review' | 'export';
const TABS: Array<[Tab, string, typeof Mic]> = [['script', 'Script', Mic], ['edit', 'Edit', SlidersHorizontal], ['smart', 'Smart', Wand2], ['style', 'Style', Palette], ['review', 'Review', MessageSquare], ['export', 'Export', Rocket]];
const FX: Array<[VoiceoverEffect['kind'], string]> = [['click', 'Click ripple'], ['spotlight', 'Spotlight'], ['highlight', 'Highlight box'], ['arrow', 'Arrow'], ['blur', 'Redact (pixelate)']];

export default function StudioEditorPage() {
  // useSearchParams needs a Suspense boundary for prerendering (Next 15).
  return <Suspense fallback={null}><StudioEditorPageInner /></Suspense>;
}

function StudioEditorPageInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const s = useStudioProject(id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('script');
  const [voices, setVoices] = useState<VoicesResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pick, setPick] = useState<PickMode | null>(null);
  const [fxMenu, setFxMenu] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const workspaceId = s.project?.workspace_id ?? null;

  const loadVoices = useCallback(() => {
    studioApi.voices(workspaceId).then(setVoices).catch(() => setVoices({ platform: { configured: false, voices: [] }, user: { configured: false, voices: [] }, models: [], pricing: { tts_credits_per_1k_chars: 20, charges: true } }));
  }, [workspaceId]);
  useEffect(() => { if (s.project) loadVoices(); }, [s.project?.id, loadVoices]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.project) studioApi.comments(id).then((r) => setComments(r.comments)).catch(() => {}); }, [id, s.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tl = s.timeline;
  const duration = useMemo(() => (tl ? timelineDuration(tl) : 0), [tl]);
  useEffect(() => { if (time > duration) setTime(duration); }, [duration, time]);

  const update = useCallback<typeof s.update>((fn, o) => { if (s.canEdit) s.update(fn, o); }, [s]);
  const seek = useCallback((t: number) => { setPlaying(false); setTime(Math.max(0, Math.min(t, duration))); }, [duration]);
  const startPick = useCallback((space: 'content' | 'frame', label: string, onPick: (x: number, y: number) => void) => {
    setPlaying(false);
    setPick({ space, label: `${label} · Esc to cancel`, onPick: (x, y) => { onPick(x, y); setPick(null); } });
  }, []);

  const select = useCallback((sel: Selection) => {
    setSelection(sel);
    setPick(null);
    if (!sel) return;
    if (sel.kind === 'block') {
      setTab('script');
      requestAnimationFrame(() => document.querySelector(`[data-block="${sel.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } else setTab('edit');
  }, []);

  const split = useCallback(() => {
    update((t) => { const r = splitAt(t, time); if (r.newId) setTimeout(() => select({ kind: 'clip', id: r.newId! }), 0); return r.timeline; });
  }, [update, time, select]);
  const addText = useCallback(() => { const o = newOverlay(time, duration); update((t) => ({ ...t, overlays: [...t.overlays, o] })); select({ kind: 'overlay', id: o.id }); }, [update, time, duration, select]);
  const addEffect = useCallback((kind: VoiceoverEffect['kind']) => {
    setFxMenu(false);
    const fx = newEffect(kind, time, duration);
    update((t) => ({ ...t, effects: [...t.effects, fx] }));
    select({ kind: 'effect', id: fx.id });
    startPick('frame', kind === 'arrow' ? 'Click what the arrow points at' : 'Click where it goes', (x, y) => update((t) => updateEffect(t, fx.id, { x, y })));
  }, [update, time, duration, select, startPick]);
  const addVoice = useCallback(() => {
    const d = loadVoiceDefaults();
    const b = newBlock(time, d ? { voice_id: d.voice_id, voice_name: d.voice_name, voice_source: d.voice_source as 'platform', model_id: d.model_id, settings: d.settings } : {});
    update((t) => upsertBlock(t, b));
    select({ kind: 'block', id: b.id });
  }, [update, time, select]);
  const deleteSelected = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'clip') update((t) => deleteClip(t, selection.id));
    if (selection.kind === 'block') update((t) => deleteBlock(t, selection.id));
    if (selection.kind === 'overlay') update((t) => deleteOverlay(t, selection.id));
    if (selection.kind === 'effect') update((t) => deleteEffect(t, selection.id));
    setSelection(null);
  }, [selection, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (k === 's') { e.preventDefault(); split(); }
      else if (k === 't') { e.preventDefault(); addText(); }
      else if (k === 'v') { e.preventDefault(); addVoice(); }
      else if (k === 'e') { e.preventDefault(); addEffect('click'); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(time - (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(time + (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'Escape') { setPick(null); setSelection(null); setFxMenu(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, split, addText, addVoice, addEffect, deleteSelected, seek, time]);

  if (s.loadError) {
    return <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm" style={{ color: C.muted }}><AlertCircle className="h-5 w-5" style={{ color: '#FCA5A5' }} /> {s.loadError}<Link href="/dashboard/studio" className="underline">Back to Studio</Link></div>;
  }
  if (!s.project || !tl || !s.project.source) {
    return <div className="flex h-screen items-center justify-center" style={{ color: C.muted }}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  const project = s.project;
  const source = project.source!;
  const selClipIdx = selection?.kind === 'clip' ? tl.clips.findIndex((c) => c.id === selection.id) : -1;
  const selClip = selClipIdx >= 0 ? tl.clips[selClipIdx] : null;
  const selOverlay = selection?.kind === 'overlay' ? tl.overlays.find((o) => o.id === selection.id) ?? null : null;
  const selEffect = selection?.kind === 'effect' ? tl.effects.find((e) => e.id === selection.id) ?? null : null;
  const clipLocal = selClip ? Math.max(0, Math.min(clipOutputDuration(selClip), time - clipStarts(tl)[selClipIdx])) : 0;
  const requireApproval = Boolean(s.workspace?.settings.require_approval);

  return (
    <div className="flex h-screen flex-col" style={{ background: C.bg }}>
      <div className="flex h-12 shrink-0 items-center gap-3 px-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <Link href={`/dashboard/studio${workspaceId ? `?workspace=${workspaceId}` : ''}`} className="rounded p-1" style={{ color: C.muted }} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        <input value={s.title} disabled={!s.canEdit} onChange={(e) => s.setTitle(e.target.value.slice(0, 200))} className="w-72 rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none focus:bg-white/5" style={{ color: C.text }} />
        {s.workspace ? <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: C.card, color: C.muted }}><Users className="h-3 w-3" /> {s.workspace.name} · {s.role}</span> : null}
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: s.saveState === 'error' ? '#FCA5A5' : C.faint }}>
          {s.saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : s.saveState === 'saved' ? <Check className="h-3 w-3" /> : null}
          {!s.canEdit ? 'View only' : s.saveState === 'saved' ? 'Saved' : s.saveState === 'saving' ? 'Saving' : s.saveState === 'error' ? 'Not saved — retrying on next edit' : 'Unsaved'}
        </span>
        {project.prepare_status === 'running' || project.prepare_status === 'pending' ? <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: C.faint }}><Loader2 className="h-3 w-3 animate-spin" /> Analysing recording…</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Undo (⌘Z)" disabled={!s.canUndo} onClick={s.undo} className="rounded p-1.5 disabled:opacity-30" style={{ color: C.text }}><Undo2 className="h-4 w-4" /></button>
          <button type="button" title="Redo (⇧⌘Z)" disabled={!s.canRedo} onClick={s.redo} className="rounded p-1.5 disabled:opacity-30" style={{ color: C.text }}><Redo2 className="h-4 w-4" /></button>
          <span className="mx-2 hidden text-[11px] xl:inline" style={{ color: C.faint }}>Space · S split · T text · V voice · E effect · Del</span>
          <Btn small primary onClick={() => setTab('export')}><Rocket className="h-3.5 w-3.5" /> Export</Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-4">
            <Preview
              source={source}
              timeline={tl}
              time={time}
              playing={playing}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
              selectedId={selOverlay?.id ?? selEffect?.id ?? null}
              onSelect={(kind, sid) => select({ kind, id: sid })}
              onOverlayMove={(oid, x, y) => update((t) => updateOverlay(t, oid, { x, y }), { coalesce: `move:${oid}` })}
              onEffectMove={(fid, x, y) => update((t) => updateEffect(t, fid, { x, y }), { coalesce: `fxmove:${fid}` })}
              pick={pick}
            />
          </div>
          <div className="flex h-11 shrink-0 items-center justify-center gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
            <button type="button" title="To start" onClick={() => seek(0)} className="rounded p-1.5" style={{ color: C.text }}><SkipBack className="h-4 w-4" /></button>
            <button type="button" title="Play / pause (Space)" onClick={() => setPlaying((p) => !p)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: C.accent, color: C.bg }}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <span className="w-28 text-center font-mono text-xs" style={{ color: C.text }}>{fmtTime(time)} / {fmtTime(duration)}</span>
            {s.canEdit ? (
              <>
                <Btn small title="Split clip at playhead (S)" onClick={split}><Scissors className="h-3.5 w-3.5" /> Split</Btn>
                <Btn small title="Add text (T)" onClick={addText}><Type className="h-3.5 w-3.5" /> Text</Btn>
                <Btn small title="Add voice block (V)" onClick={addVoice}><Mic className="h-3.5 w-3.5" /> Voice</Btn>
                <div className="relative">
                  <Btn small title="Add effect (E = click)" onClick={() => setFxMenu((o) => !o)}><Sparkles className="h-3.5 w-3.5" /> Effect <ChevronDown className="h-3 w-3" /></Btn>
                  {fxMenu ? (
                    <div className="absolute bottom-9 left-0 z-40 w-44 rounded-lg p-1" style={{ background: C.card, border: `1px solid ${C.line2}` }}>
                      {FX.map(([k, label]) => <button key={k} type="button" onClick={() => addEffect(k)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-white/5" style={{ color: C.text }}>{label}</button>)}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex w-[400px] shrink-0 flex-col" style={{ borderLeft: `1px solid ${C.line}`, background: C.side }}>
          <div className="flex shrink-0 gap-0.5 p-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
            {TABS.map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="inline-flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1 text-[10px]" style={tab === k ? { background: C.hover, color: C.text } : { color: C.muted }}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'script' ? (
              <VoicePanel projectId={id} workspaceId={workspaceId} language={project.language} timeline={tl} time={time} voices={voices}
                selectedId={selection?.kind === 'block' ? selection.id : null} canEdit={s.canEdit} autoGenerate={search.get('autogen') === '1'}
                onSelect={(bid) => setSelection({ kind: 'block', id: bid })} update={update} onSeek={seek}
                onPlayFrom={(t) => { setTime(t); setPlaying(true); }} onOpenSettings={() => setSettingsOpen(true)} onVoicesChanged={loadVoices} beforePresenter={s.flush} />
            ) : tab === 'edit' ? (
              selClip ? (
                <ClipInspector clip={selClip} index={selClipIdx} count={tl.clips.length} localTime={clipLocal} picking={Boolean(pick)}
                  onChange={(patch, co) => update((t) => updateClip(t, selClip.id, patch), co ? { coalesce: `${co}:${selClip.id}` } : undefined)}
                  onPick={startPick} onSplit={split} onDelete={deleteSelected} onMove={(dir) => update((t) => moveClip(t, selClip.id, dir))} />
              ) : selOverlay ? (
                <OverlayInspector o={selOverlay} fonts={tl.fonts} onPick={startPick}
                  onChange={(patch, co) => update((t) => updateOverlay(t, selOverlay.id, patch), co ? { coalesce: `${co}:${selOverlay.id}` } : undefined)} onDelete={deleteSelected} />
              ) : selEffect ? (
                <EffectInspector fx={selEffect} onPick={startPick}
                  onChange={(patch, co) => update((t) => updateEffect(t, selEffect.id, patch), co ? { coalesce: `${co}:${selEffect.id}` } : undefined)} onDelete={deleteSelected} />
              ) : (
                <div className="space-y-3 p-4 text-xs" style={{ color: C.muted }}>
                  <p>Select a clip, text or effect on the timeline to edit it.</p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><b style={{ color: C.text }}>Cut</b>: press <kbd>S</kbd> at the playhead, delete the unwanted part.</li>
                    <li><b style={{ color: C.text }}>Camera</b>: select a clip → Keyframes → add points and pick what to frame.</li>
                    <li><b style={{ color: C.text }}>Clicks</b>: press <kbd>E</kbd>, then click on the preview.</li>
                    <li><b style={{ color: C.text }}>Redact</b>: Effect → Redact to pixelate emails or keys.</li>
                  </ul>
                </div>
              )
            ) : tab === 'smart' ? (
              <SmartPanel project={project} timeline={tl} update={update} onSeek={seek} onRerun={async () => { await studioApi.prepare(id).catch(() => {}); s.patchProject({ prepare_status: 'running' }); }} />
            ) : tab === 'style' ? (
              <StylePanel projectId={id} workspaceId={workspaceId} timeline={tl} update={update} onTimelineReplaced={(t: VoiceoverTimeline) => update(() => t)} />
            ) : tab === 'review' ? (
              <ReviewPanel projectId={id} status={project.review_status} role={s.role} requireApproval={requireApproval} time={time} onSeek={seek}
                onStatus={(review_status) => s.patchProject({ review_status })} onComments={setComments} />
            ) : (
              <ExportPanel projectId={id} source={source} timeline={tl} lastRunId={project.last_render_run_id} reviewStatus={project.review_status}
                requireApproval={requireApproval} canRender={s.canEdit} voices={voices} language={project.language}
                onOutputChange={(patch) => update((t) => ({ ...t, output: { ...t.output, ...patch } }))} beforeRender={s.flush} />
            )}
          </div>
        </div>
      </div>

      <div className="h-[260px] shrink-0">
        <Timeline timeline={tl} source={source} time={time} duration={duration} selection={selection}
          suggestions={project.analysis?.suggestions ?? []} comments={comments}
          onSelect={select} onSeek={seek}
          onClipChange={(cid, patch) => update((t) => updateClip(t, cid, patch), { coalesce: `trim:${cid}` })}
          onBlockMove={(bid, start) => update((t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === bid ? { ...b, start } : b)).sort((a, z) => a.start - z.start) }), { coalesce: `bmove:${bid}` })}
          onOverlayChange={(oid, st, en) => update((t) => updateOverlay(t, oid, { start: st, end: en }), { coalesce: `omove:${oid}` })}
          onEffectChange={(fid, st, en) => update((t) => updateEffect(t, fid, { start: st, end: en }), { coalesce: `fxr:${fid}` })}
          onSuggestion={() => setTab('smart')} />
      </div>

      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} onChanged={loadVoices} /> : null}
    </div>
  );
}
