// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * The voice-over script, ElevenLabs-Studio style: one card per paragraph
 * ("voice block") placed on the timeline. Each block has its own voice, model
 * and settings, shows whether its narration fits before the next block (the
 * cue sheet's "max Ns"), and is generated/regenerated independently. Neighbour
 * text is sent as previous_text/next_text so consecutive blocks keep the same
 * delivery.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, FileText, Loader2, Play, Plus, Settings2, Sparkles, Trash2, Volume2, Wand2, X } from 'lucide-react';
import { VoiceSettingsSchema, quoteVoiceoverTtsCredits, type VoiceBlock, type VoiceSettings, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { studioApi, StudioApiError, type VoicesResponse, type Voice } from '../_lib/api';
import {
  autoSpaceBlocks, blockDuration, blockIsStale, blockRoom, deleteBlock, fmtTime, newBlock, parseScript, parseTimeInput, placeCues, updateBlock, upsertBlock,
} from '../_lib/ops';
import { C, Btn, Field, Select, Slider } from './ui';

export interface VoiceDefaults {
  voice_id: string;
  voice_name?: string;
  voice_source: 'platform' | 'user';
  model_id: string;
  settings: VoiceSettings;
}

const DEFAULTS_KEY = 'studio.voiceDefaults.v1';

export function loadVoiceDefaults(): VoiceDefaults | null {
  try { const raw = localStorage.getItem(DEFAULTS_KEY); return raw ? (JSON.parse(raw) as VoiceDefaults) : null; } catch { return null; }
}
function saveVoiceDefaults(d: VoiceDefaults) {
  try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

interface Props {
  projectId: string;
  timeline: VoiceoverTimeline;
  time: number;
  duration: number;
  voices: VoicesResponse | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  update: (fn: (t: VoiceoverTimeline) => VoiceoverTimeline, opts?: { coalesce?: string }) => void;
  onSeek: (t: number) => void;
  onPlayFrom: (t: number) => void;
  onOpenSettings: () => void;
}

type Gen = { state: 'idle' | 'busy' | 'error'; message?: string; code?: string };

export function VoicePanel(p: Props) {
  const { timeline, voices } = p;
  const [defaults, setDefaults] = useState<VoiceDefaults | null>(null);
  const [gen, setGen] = useState<Record<string, Gen>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const cancelBulk = useRef(false);

  // Pick a sensible default voice once the catalogue loads: the user's own
  // cloned voice first (that's the point of this feature), else ours.
  useEffect(() => {
    if (!voices || defaults) return;
    const saved = loadVoiceDefaults();
    const all = [...voices.user.voices.map((v) => ({ v, s: 'user' as const })), ...voices.platform.voices.map((v) => ({ v, s: 'platform' as const }))];
    const savedOk = saved && all.some((x) => x.v.voice_id === saved.voice_id && x.s === saved.voice_source);
    if (savedOk) { setDefaults(saved!); return; }
    const first = all[0];
    setDefaults({
      voice_id: first?.v.voice_id ?? '',
      voice_name: first?.v.name,
      voice_source: first?.s ?? 'platform',
      model_id: voices.models.find((m) => m.model_id === 'eleven_multilingual_v2')?.model_id ?? voices.models[0]?.model_id ?? 'eleven_multilingual_v2',
      settings: VoiceSettingsSchema.parse({}),
    });
  }, [voices, defaults]);

  const setDefault = (patch: Partial<VoiceDefaults>) => {
    setDefaults((d) => { const n = { ...(d as VoiceDefaults), ...patch }; saveVoiceDefaults(n); return n; });
  };

  const blocks = timeline.blocks;
  const pending = blocks.filter((b) => b.text.trim() && (!b.audio_url || blockIsStale(b)) && b.voice_id);
  const pendingChars = pending.reduce((s, b) => s + b.text.trim().length, 0);
  const charges = voices?.pricing.charges ?? true;
  const pendingCredits = pending
    .filter((b) => b.voice_source === 'platform')
    .reduce((s, b) => s + quoteVoiceoverTtsCredits(b.text.trim().length), 0);

  const blockDefaults = (): Partial<VoiceBlock> => defaults
    ? { voice_id: defaults.voice_id, voice_name: defaults.voice_name, voice_source: defaults.voice_source, model_id: defaults.model_id, settings: defaults.settings }
    : {};

  const addAtPlayhead = () => {
    const b = newBlock(p.time, blockDefaults());
    p.update((t) => upsertBlock(t, b));
    p.onSelect(b.id);
  };

  async function generate(b: VoiceBlock): Promise<{ ok: boolean; code?: string }> {
    if (!b.text.trim()) return { ok: false };
    if (!b.voice_id) { setGen((g) => ({ ...g, [b.id]: { state: 'error', message: 'Pick a voice first.' } })); return { ok: false }; }
    setGen((g) => ({ ...g, [b.id]: { state: 'busy' } }));
    const sorted = [...blocks].sort((a, z) => a.start - z.start);
    const i = sorted.findIndex((x) => x.id === b.id);
    try {
      const r = await studioApi.tts({
        project_id: p.projectId,
        block_id: b.id,
        text: b.text.trim(),
        voice_id: b.voice_id,
        voice_source: b.voice_source,
        model_id: b.model_id,
        settings: b.settings,
        previous_text: sorted[i - 1]?.text.trim().slice(-1000) || undefined,
        next_text: sorted[i + 1]?.text.trim().slice(0, 1000) || undefined,
      });
      p.update((t) => updateBlock(t, b.id, {
        audio_url: r.audio_url,
        audio_duration: r.audio_duration,
        words: r.words,
        take_id: r.take_id,
        generated_text: b.text,
      }));
      setGen((g) => ({ ...g, [b.id]: { state: 'idle' } }));
      return { ok: true };
    } catch (e) {
      const err = e as StudioApiError;
      setGen((g) => ({ ...g, [b.id]: { state: 'error', message: err.message, code: err.code } }));
      return { ok: false, code: err.code };
    }
  }

  async function generateAll() {
    cancelBulk.current = false;
    const queue = [...pending].sort((a, z) => a.start - z.start);
    setBulk({ done: 0, total: queue.length });
    for (let i = 0; i < queue.length; i++) {
      if (cancelBulk.current) break;
      const r = await generate(queue[i]);
      setBulk({ done: i + 1, total: queue.length });
      if (!r.ok && (r.code === 'INSUFFICIENT_CREDITS' || r.code === 'KEY_REJECTED' || r.code === 'NOT_CONFIGURED')) break;
    }
    setBulk(null);
  }

  const voiceOptions = useMemo(() => {
    if (!voices) return [];
    const groups: { label: string; source: 'user' | 'platform'; voices: Voice[] }[] = [];
    if (voices.user.voices.length) groups.push({ label: `My ElevenLabs voices (…${voices.user.last4 ?? ''})`, source: 'user', voices: voices.user.voices });
    if (voices.platform.voices.length) groups.push({ label: 'Vantly voices', source: 'platform', voices: voices.platform.voices });
    return groups;
  }, [voices]);

  return (
    <div className="flex h-full flex-col">
      {/* Defaults + actions */}
      <div className="space-y-2 p-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold" style={{ color: C.text }}>Voice-over script</p>
          <button type="button" onClick={p.onOpenSettings} className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: C.muted }}>
            <Settings2 className="h-3.5 w-3.5" /> {voices?.user.configured ? `My key …${voices.user.last4 ?? ''}` : 'Use my ElevenLabs key'}
          </button>
        </div>
        {voices && !voices.platform.configured && !voices.user.configured ? (
          <div className="rounded-lg p-2 text-[11px]" style={{ background: 'rgba(252,211,77,0.08)', color: '#FCD34D' }}>
            Voices aren&rsquo;t set up on this server yet. <button type="button" className="underline" onClick={p.onOpenSettings}>Add your ElevenLabs API key</button> to use your own voices.
          </div>
        ) : null}
        {voices?.user.error ? <div className="text-[11px]" style={{ color: '#FCA5A5' }}>{voices.user.error}</div> : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Default voice">
            <VoiceSelect groups={voiceOptions} value={defaults ? `${defaults.voice_source}:${defaults.voice_id}` : ''} onChange={(source, v) => setDefault({ voice_id: v.voice_id, voice_name: v.name, voice_source: source })} />
          </Field>
          <Field label="Model">
            <Select value={defaults?.model_id ?? ''} onChange={(e) => setDefault({ model_id: e.target.value })}>
              {(voices?.models ?? []).map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Btn small onClick={addAtPlayhead}><Plus className="h-3.5 w-3.5" /> Block at {fmtTime(p.time)}</Btn>
          <Btn small onClick={() => setImportOpen(true)}><FileText className="h-3.5 w-3.5" /> Import script</Btn>
          <Btn small title="Push blocks right so none overlaps the one before" onClick={() => p.update(autoSpaceBlocks)}><Wand2 className="h-3.5 w-3.5" /> Auto-space</Btn>
          {bulk ? (
            <Btn small onClick={() => { cancelBulk.current = true; }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> {bulk.done}/{bulk.total} · Stop</Btn>
          ) : (
            <Btn small primary disabled={!pending.length} onClick={generateAll}>
              <Sparkles className="h-3.5 w-3.5" /> Generate {pending.length || ''} {pending.length ? `· ${pendingChars} chars${charges && pendingCredits ? ` · ${pendingCredits} cr` : ''}` : 'all'}
            </Btn>
          )}
        </div>
      </div>

      {/* Blocks */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {blocks.length === 0 ? (
          <div className="rounded-xl p-6 text-center text-xs" style={{ border: `1px dashed ${C.line2}`, color: C.muted }}>
            <Volume2 className="mx-auto mb-2 h-5 w-5" style={{ color: C.accent }} />
            Write the narration for each scene, or <button type="button" className="underline" onClick={() => setImportOpen(true)}>import a script / cue sheet / SRT</button>.
          </div>
        ) : null}
        {blocks.map((b) => (
          <BlockCard
            key={b.id}
            b={b}
            room={blockRoom(timeline, b)}
            selected={p.selectedId === b.id}
            gen={gen[b.id] ?? { state: 'idle' }}
            groups={voiceOptions}
            models={voices?.models ?? []}
            charges={charges}
            onSelect={() => { p.onSelect(b.id); }}
            onChange={(patch, coalesce) => p.update((t) => updateBlock(t, b.id, patch), coalesce ? { coalesce: `${coalesce}:${b.id}` } : undefined)}
            onDelete={() => p.update((t) => deleteBlock(t, b.id))}
            onGenerate={() => void generate(b)}
            onSeek={() => p.onSeek(b.start)}
            onPlay={() => p.onPlayFrom(b.start)}
            onApplyVoiceToAll={() => p.update((t) => ({ ...t, blocks: t.blocks.map((x) => ({ ...x, voice_id: b.voice_id, voice_name: b.voice_name, voice_source: b.voice_source, model_id: b.model_id, settings: b.settings })) }))}
          />
        ))}
      </div>

      {importOpen ? (
        <ImportDialog
          time={p.time}
          hasBlocks={blocks.length > 0}
          onClose={() => setImportOpen(false)}
          onImport={(raw, mode) => {
            const cues = parseScript(raw);
            const placed = placeCues(cues, mode === 'append' ? p.time : 0, blockDefaults());
            p.update((t) => {
              const base = mode === 'replace' ? { ...t, blocks: [] } : t;
              return placed.reduce((acc, b) => upsertBlock(acc, b), base);
            });
            setImportOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function VoiceSelect({ groups, value, onChange }: {
  groups: { label: string; source: 'user' | 'platform'; voices: Voice[] }[];
  value: string;
  onChange: (source: 'user' | 'platform', v: Voice) => void;
}) {
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const current = (() => {
    const [s, id] = value.split(':');
    return groups.find((g) => g.source === s)?.voices.find((v) => v.voice_id === id) ?? null;
  })();
  return (
    <div className="flex items-center gap-1">
      <Select
        value={value}
        onChange={(e) => {
          const [s, id] = e.target.value.split(':');
          const v = groups.find((g) => g.source === s)?.voices.find((x) => x.voice_id === id);
          if (v) onChange(s as 'user' | 'platform', v);
        }}
      >
        {!current ? <option value="">Choose a voice…</option> : null}
        {groups.map((g) => (
          <optgroup key={g.source} label={g.label}>
            {g.voices.map((v) => (
              <option key={v.voice_id} value={`${g.source}:${v.voice_id}`}>
                {v.name}{v.category === 'cloned' || v.category === 'professional' ? ' ★' : ''}{v.labels?.accent ? ` · ${v.labels.accent}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {current?.preview_url ? (
        <button
          type="button"
          title="Hear a sample"
          className="shrink-0 rounded-md p-1.5"
          style={{ border: `1px solid ${C.line2}`, color: C.muted }}
          onClick={() => {
            previewRef.current?.pause();
            previewRef.current = new Audio(current.preview_url!);
            void previewRef.current.play().catch(() => {});
          }}
        >
          <Volume2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function BlockCard(p: {
  b: VoiceBlock;
  room: number;
  selected: boolean;
  gen: Gen;
  groups: { label: string; source: 'user' | 'platform'; voices: Voice[] }[];
  models: { model_id: string; name: string }[];
  charges: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<VoiceBlock>, coalesce?: string) => void;
  onDelete: () => void;
  onGenerate: () => void;
  onSeek: () => void;
  onPlay: () => void;
  onApplyVoiceToAll: () => void;
}) {
  const { b } = p;
  const [showSettings, setShowSettings] = useState(false);
  const [startText, setStartText] = useState(fmtTime(b.start));
  useEffect(() => setStartText(fmtTime(b.start)), [b.start]);
  const dur = blockDuration(b);
  const fits = dur <= p.room + 0.05;
  const stale = blockIsStale(b);
  const chars = b.text.trim().length;
  const cost = p.charges && b.voice_source === 'platform' ? quoteVoiceoverTtsCredits(chars) : 0;

  return (
    <div
      data-block={b.id}
      onClick={p.onSelect}
      className="rounded-xl p-2.5"
      style={{ background: p.selected ? '#1B1C2A' : C.card, border: `1px solid ${p.selected ? 'rgba(167,139,250,0.5)' : C.line}` }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}>
        <input
          value={startText}
          onChange={(e) => setStartText(e.target.value)}
          onBlur={() => { const v = parseTimeInput(startText); if (v !== null) p.onChange({ start: Math.max(0, v) }); else setStartText(fmtTime(b.start)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-14 rounded px-1 py-0.5 font-mono outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }}
          title="Start time (m:ss.s)"
        />
        <button type="button" onClick={(e) => { e.stopPropagation(); p.onSeek(); }} className="hover:underline">jump</button>
        <span className="ml-1 inline-flex items-center gap-1" style={{ color: fits ? '#6EE7B7' : '#FCA5A5' }} title="Narration length vs. room before the next block">
          {fits ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {b.audio_url ? '' : '~'}{dur.toFixed(1)}s / {p.room.toFixed(1)}s
        </span>
        <span className="ml-auto">
          {!b.audio_url ? 'not generated' : stale ? <span style={{ color: '#FCD34D' }}>text changed</span> : <span style={{ color: '#6EE7B7' }}>generated</span>}
        </span>
      </div>

      <textarea
        value={b.text}
        onChange={(e) => p.onChange({ text: e.target.value }, 'text')}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); p.onGenerate(); } }}
        rows={Math.min(8, Math.max(2, Math.ceil(b.text.length / 48)))}
        placeholder="What should the narrator say over this part?"
        className="w-full resize-y rounded-lg px-2 py-1.5 text-[13px] leading-snug outline-none"
        style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }}
      />

      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <VoiceSelect groups={p.groups} value={`${b.voice_source}:${b.voice_id}`} onChange={(source, v) => p.onChange({ voice_id: v.voice_id, voice_name: v.name, voice_source: source })} />
        </div>
        <button type="button" title="Voice settings" onClick={(e) => { e.stopPropagation(); setShowSettings((s) => !s); }} className="rounded-md p-1.5" style={{ border: `1px solid ${C.line2}`, color: C.muted }}>
          <ChevronDown className="h-3.5 w-3.5" style={{ transform: showSettings ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>

      {showSettings ? (
        <div className="mt-2 space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
          <Field label="Model">
            <Select value={b.model_id} onChange={(e) => p.onChange({ model_id: e.target.value })}>
              {p.models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
            </Select>
          </Field>
          <Slider label="Speed" min={0.7} max={1.2} step={0.01} value={b.settings.speed} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => p.onChange({ settings: { ...b.settings, speed: v } }, 'speed')} />
          <Slider label="Stability" hint="Lower = more expressive" min={0} max={1} step={0.01} value={b.settings.stability} onChange={(v) => p.onChange({ settings: { ...b.settings, stability: v } }, 'stab')} />
          <Slider label="Similarity" min={0} max={1} step={0.01} value={b.settings.similarity_boost} onChange={(v) => p.onChange({ settings: { ...b.settings, similarity_boost: v } }, 'sim')} />
          <Slider label="Style exaggeration" min={0} max={1} step={0.01} value={b.settings.style} onChange={(v) => p.onChange({ settings: { ...b.settings, style: v } }, 'style')} />
          <Slider label="Block volume" min={0} max={2} step={0.05} value={b.volume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => p.onChange({ volume: v }, 'vol')} />
          <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
            <input type="checkbox" checked={b.settings.use_speaker_boost} onChange={(e) => p.onChange({ settings: { ...b.settings, use_speaker_boost: e.target.checked } })} /> Speaker boost
          </label>
          <button type="button" className="text-[11px] underline" style={{ color: C.muted }} onClick={p.onApplyVoiceToAll}>Use this voice & settings for every block</button>
        </div>
      ) : null}

      {p.gen.state === 'error' ? (
        <div className="mt-1.5 text-[11px]" style={{ color: '#FCA5A5' }}>
          {p.gen.message}{' '}
          {p.gen.code === 'INSUFFICIENT_CREDITS' ? <Link href="/dashboard/billing" className="underline">Top up</Link> : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        <Btn small primary={!b.audio_url || stale} disabled={!chars || p.gen.state === 'busy'} onClick={(e) => { e.stopPropagation(); p.onGenerate(); }}>
          {p.gen.state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {b.audio_url ? 'Regenerate' : 'Generate'}{cost ? ` · ${cost} cr` : ''}
        </Btn>
        <Btn small disabled={!b.audio_url} onClick={(e) => { e.stopPropagation(); p.onPlay(); }}><Play className="h-3.5 w-3.5" /> Play</Btn>
        <span className="ml-auto text-[10px]" style={{ color: C.faint }}>{chars} chars</span>
        <button type="button" title="Delete block" onClick={(e) => { e.stopPropagation(); p.onDelete(); }} className="rounded p-1" style={{ color: '#FCA5A5' }}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function ImportDialog({ time, hasBlocks, onClose, onImport }: {
  time: number;
  hasBlocks: boolean;
  onClose: () => void;
  onImport: (raw: string, mode: 'replace' | 'append') => void;
}) {
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>(hasBlocks ? 'append' : 'replace');
  const cues = useMemo(() => parseScript(raw), [raw]);
  const timed = cues.filter((c) => c.start !== null).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.line2}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>Import narration</p>
          <button type="button" className="ml-auto" onClick={onClose} style={{ color: C.muted }}><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-2 text-xs" style={{ color: C.muted }}>
          Paste a script (one block per paragraph), an <b>ElevenLabs cue sheet</b> (<code>CUE 1 | start 0:00.0 | …</code>) or an <b>.srt</b>. Timed cues land at their times; the rest follow one after another.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          className="w-full rounded-lg p-2 font-mono text-xs outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }}
          placeholder={'What if you could watch a course before paying?\n\nThe Courses page lists everything…'}
        />
        <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: C.muted }}>
          <label className="cursor-pointer underline">
            or choose a file
            <input type="file" accept=".txt,.md,.srt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRaw(await f.text()); }} />
          </label>
          <span className="ml-auto">{cues.length} blocks{timed ? ` · ${timed} timed` : ''}</span>
        </div>
        {hasBlocks ? (
          <div className="mt-3 flex gap-4 text-xs" style={{ color: C.text }}>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add at playhead ({fmtTime(time)})</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace all blocks</label>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!cues.length} onClick={() => onImport(raw, mode)}>Import {cues.length || ''} blocks</Btn>
        </div>
      </div>
    </div>
  );
}
