// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/studio/[id] — Voiceover Studio editor.
 *
 *   ┌──────────── preview ────────────┬── Script | Edit | Export ──┐
 *   │  live preview of the edit       │  ElevenLabs voice blocks,   │
 *   │  (cuts, zoom, text, voice)      │  clip/text inspector,       │
 *   ├─────────── transport ───────────┤  render + publish           │
 *   ├──────────── timeline: Video / Voice / Text ───────────────────┤
 *
 * Keys: Space play · S split · T text · V voice block · Del delete ·
 *       ←/→ 1s (Shift 5s) · ⌘Z / ⇧⌘Z undo/redo
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Loader2, Mic, Pause, Play, Redo2, Rocket, Scissors, SlidersHorizontal, SkipBack, Type, Undo2, AlertCircle } from 'lucide-react';
import { timelineDuration, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { useStudioProject } from '../_lib/use-project';
import { studioApi, type VoicesResponse } from '../_lib/api';
import {
  deleteBlock, deleteClip, deleteOverlay, fmtTime, moveClip, newBlock, newOverlay, splitAt, updateClip, updateOverlay, upsertBlock,
} from '../_lib/ops';
import { Preview } from '../_components/preview';
import { Timeline, type Selection } from '../_components/timeline';
import { VoicePanel, loadVoiceDefaults } from '../_components/voice-panel';
import { ClipInspector, OverlayInspector } from '../_components/inspector';
import { ExportPanel } from '../_components/export-panel';
import { SettingsDialog } from '../_components/settings-dialog';
import { Btn, C } from '../_components/ui';

type Tab = 'script' | 'edit' | 'export';

export default function StudioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const s = useStudioProject(id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('script');
  const [voices, setVoices] = useState<VoicesResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickFocus, setPickFocus] = useState<string | null>(null);

  const loadVoices = useCallback(() => {
    studioApi.voices().then(setVoices).catch(() => setVoices({ platform: { configured: false, voices: [] }, user: { configured: false, voices: [] }, models: [], pricing: { tts_credits_per_1k_chars: 20, charges: true } }));
  }, []);
  useEffect(() => { loadVoices(); }, [loadVoices]);

  const tl = s.timeline;
  const duration = useMemo(() => (tl ? timelineDuration(tl) : 0), [tl]);
  useEffect(() => { if (time > duration) setTime(duration); }, [duration, time]);

  const update = s.update;
  const seek = useCallback((t: number) => { setPlaying(false); setTime(Math.max(0, Math.min(t, duration))); }, [duration]);

  const select = useCallback((sel: Selection) => {
    setSelection(sel);
    setPickFocus(null);
    if (!sel) return;
    if (sel.kind === 'block') {
      setTab('script');
      requestAnimationFrame(() => document.querySelector(`[data-block="${sel.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } else {
      setTab('edit');
    }
  }, []);

  const split = useCallback(() => {
    update((t) => {
      const r = splitAt(t, time);
      if (r.newId) setTimeout(() => select({ kind: 'clip', id: r.newId! }), 0);
      return r.timeline;
    });
  }, [update, time, select]);

  const addText = useCallback(() => {
    const o = newOverlay(time, duration);
    update((t) => ({ ...t, overlays: [...t.overlays, o] }));
    select({ kind: 'overlay', id: o.id });
  }, [update, time, duration, select]);

  const addVoice = useCallback(() => {
    const d = loadVoiceDefaults();
    const b = newBlock(time, d ? { voice_id: d.voice_id, voice_name: d.voice_name, voice_source: d.voice_source, model_id: d.model_id, settings: d.settings } : {});
    update((t) => upsertBlock(t, b));
    select({ kind: 'block', id: b.id });
  }, [update, time, select]);

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'clip') update((t) => deleteClip(t, selection.id));
    if (selection.kind === 'block') update((t) => deleteBlock(t, selection.id));
    if (selection.kind === 'overlay') update((t) => deleteOverlay(t, selection.id));
    setSelection(null);
  }, [selection, update]);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); split(); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); addText(); }
      else if (e.key === 'v' || e.key === 'V') { e.preventDefault(); addVoice(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(time - (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(time + (e.shiftKey ? 5 : 1)); }
      else if (e.key === 'Escape') { setPickFocus(null); setSelection(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, split, addText, addVoice, deleteSelected, seek, time]);

  if (s.loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm" style={{ color: C.muted }}>
        <AlertCircle className="h-5 w-5" style={{ color: '#FCA5A5' }} /> {s.loadError}
        <Link href="/dashboard/studio" className="underline">Back to Studio</Link>
      </div>
    );
  }
  if (!s.project || !tl || !s.project.source) {
    return <div className="flex h-screen items-center justify-center" style={{ color: C.muted }}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  const source = s.project.source;

  const selClipIdx = selection?.kind === 'clip' ? tl.clips.findIndex((c) => c.id === selection.id) : -1;
  const selClip = selClipIdx >= 0 ? tl.clips[selClipIdx] : null;
  const selOverlay = selection?.kind === 'overlay' ? tl.overlays.find((o) => o.id === selection.id) ?? null : null;

  return (
    <div className="flex h-screen flex-col" style={{ background: C.bg }}>
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 px-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <Link href="/dashboard/studio" className="rounded p-1" style={{ color: C.muted }} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Link>
        <input
          value={s.title}
          onChange={(e) => s.setTitle(e.target.value.slice(0, 200))}
          className="w-72 rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none focus:bg-white/5"
          style={{ color: C.text }}
        />
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: s.saveState === 'error' ? '#FCA5A5' : C.faint }}>
          {s.saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : s.saveState === 'saved' ? <Check className="h-3 w-3" /> : null}
          {s.saveState === 'saved' ? 'Saved' : s.saveState === 'saving' ? 'Saving' : s.saveState === 'error' ? 'Not saved — retrying on next edit' : 'Unsaved'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Undo (⌘Z)" disabled={!s.canUndo} onClick={s.undo} className="rounded p-1.5 disabled:opacity-30" style={{ color: C.text }}><Undo2 className="h-4 w-4" /></button>
          <button type="button" title="Redo (⇧⌘Z)" disabled={!s.canRedo} onClick={s.redo} className="rounded p-1.5 disabled:opacity-30" style={{ color: C.text }}><Redo2 className="h-4 w-4" /></button>
          <span className="mx-2 hidden text-[11px] xl:inline" style={{ color: C.faint }}>Space play · S split · T text · V voice · Del delete</span>
          <Btn small primary onClick={() => setTab('export')}><Rocket className="h-3.5 w-3.5" /> Export</Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Preview + transport */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-4">
            <Preview
              source={source}
              timeline={tl}
              time={time}
              playing={playing}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
              selectedOverlayId={selOverlay?.id ?? null}
              onSelectOverlay={(oid) => select({ kind: 'overlay', id: oid })}
              onOverlayMove={(oid, x, y) => update((t) => updateOverlay(t, oid, { x, y }), { coalesce: `move:${oid}` })}
              pickFocusFor={pickFocus}
              onFocusPick={(cid, x, y) => {
                update((t) => ({ ...t, clips: t.clips.map((c) => (c.id === cid ? { ...c, zoom: { ...c.zoom, x, y } } : c)) }));
                setPickFocus(null);
              }}
            />
          </div>
          <div className="flex h-11 shrink-0 items-center justify-center gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
            <button type="button" title="To start" onClick={() => seek(0)} className="rounded p-1.5" style={{ color: C.text }}><SkipBack className="h-4 w-4" /></button>
            <button type="button" title="Play / pause (Space)" onClick={() => setPlaying((p) => !p)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: C.accent, color: C.bg }}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <span className="w-28 text-center font-mono text-xs" style={{ color: C.text }}>{fmtTime(time)} / {fmtTime(duration)}</span>
            <Btn small title="Split clip at playhead (S)" onClick={split}><Scissors className="h-3.5 w-3.5" /> Split</Btn>
            <Btn small title="Add text (T)" onClick={addText}><Type className="h-3.5 w-3.5" /> Text</Btn>
            <Btn small title="Add voice block (V)" onClick={addVoice}><Mic className="h-3.5 w-3.5" /> Voice</Btn>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex w-[380px] shrink-0 flex-col" style={{ borderLeft: `1px solid ${C.line}`, background: C.side }}>
          <div className="flex shrink-0 gap-1 p-2" style={{ borderBottom: `1px solid ${C.line}` }}>
            {([['script', 'Script', Mic], ['edit', 'Edit', SlidersHorizontal], ['export', 'Export', Rocket]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs"
                style={tab === k ? { background: C.hover, color: C.text } : { color: C.muted }}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'script' ? (
              <VoicePanel
                projectId={id}
                timeline={tl}
                time={time}
                duration={duration}
                voices={voices}
                selectedId={selection?.kind === 'block' ? selection.id : null}
                onSelect={(bid) => setSelection({ kind: 'block', id: bid })}
                update={update}
                onSeek={seek}
                onPlayFrom={(t) => { setTime(t); setPlaying(true); }}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            ) : tab === 'edit' ? (
              selClip ? (
                <ClipInspector
                  clip={selClip}
                  index={selClipIdx}
                  count={tl.clips.length}
                  picking={pickFocus === selClip.id}
                  onChange={(patch, co) => update((t) => updateClip(t, selClip.id, patch), co ? { coalesce: `${co}:${selClip.id}` } : undefined)}
                  onPickFocus={() => { setPlaying(false); setPickFocus((p) => (p === selClip.id ? null : selClip.id)); }}
                  onSplit={split}
                  onDelete={deleteSelected}
                  onMove={(dir) => update((t) => moveClip(t, selClip.id, dir))}
                />
              ) : selOverlay ? (
                <OverlayInspector
                  o={selOverlay}
                  onChange={(patch, co) => update((t) => updateOverlay(t, selOverlay.id, patch), co ? { coalesce: `${co}:${selOverlay.id}` } : undefined)}
                  onDelete={deleteSelected}
                />
              ) : (
                <div className="space-y-3 p-4 text-xs" style={{ color: C.muted }}>
                  <p>Select a clip or a text on the timeline to edit it.</p>
                  <ul className="list-disc space-y-1 pl-4">
                    <li><b style={{ color: C.text }}>Cut</b>: move the playhead and press <kbd>S</kbd>, then delete the unwanted part.</li>
                    <li><b style={{ color: C.text }}>Trim</b>: drag a clip&rsquo;s left/right edge.</li>
                    <li><b style={{ color: C.text }}>Zoom</b>: select a clip → Focus → pick the point on the preview.</li>
                    <li><b style={{ color: C.text }}>Speed</b>: 1.5–2× for long scrolls and page loads.</li>
                  </ul>
                  <Btn small onClick={addText}><Type className="h-3.5 w-3.5" /> Add text at {fmtTime(time)}</Btn>
                </div>
              )
            ) : (
              <ExportPanel
                projectId={id}
                source={source}
                timeline={tl}
                lastRunId={s.project.last_render_run_id}
                onOutputChange={(patch) => update((t: VoiceoverTimeline) => ({ ...t, output: { ...t.output, ...patch } }))}
                beforeRender={s.flush}
              />
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="h-[236px] shrink-0">
        <Timeline
          timeline={tl}
          source={source}
          time={time}
          duration={duration}
          selection={selection}
          onSelect={select}
          onSeek={seek}
          onClipChange={(cid, patch) => update((t) => updateClip(t, cid, patch), { coalesce: `trim:${cid}` })}
          onBlockMove={(bid, start) => update((t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === bid ? { ...b, start } : b)).sort((a, z) => a.start - z.start) }), { coalesce: `bmove:${bid}` })}
          onOverlayChange={(oid, st, en) => update((t) => updateOverlay(t, oid, { start: st, end: en }), { coalesce: `omove:${oid}` })}
        />
      </div>

      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} onChanged={loadVoices} /> : null}
    </div>
  );
}
