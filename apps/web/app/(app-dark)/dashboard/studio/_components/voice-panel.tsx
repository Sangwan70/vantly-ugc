// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * The voice-over script, ElevenLabs-Studio style. One card per paragraph
 * ("voice block") with its own voice, model and settings. Pro controls:
 * takes (A/B), split at cursor, regenerate just a selection, pause tags,
 * pronunciation dictionary, fit-to-slot (speed / AI shorten / stretch video),
 * workspace voices and voice-clone consent.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BookA, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Loader2, Pause as PauseIcon, Play, Plus, Scissors, Settings2, ShieldCheck, Sparkles, Trash2, User, Volume2, Wand2, X } from 'lucide-react';
import {
  VoiceSettingsSchema, blockAudioLength, presenterBlockProblem, presenterClipFor, presenterFrame, presenterTakeSeconds, quotePresenterCredits, quoteVoiceoverTtsCredits,
  type VoiceBlock, type VoiceSettings, type VoiceoverPresenter, type VoiceoverTimeline,
} from '@vantly-ugc/schema';
import { studioApi, StudioApiError, uploadDirect, type VoicesResponse, type Voice, type VoiceSource } from '../_lib/api';
import {
  autoSpaceBlocks, blockDuration, blockIsStale, blockRoom, blockStaleReason, deleteBlock, fmtTime, newBlock, parseScript, parseTimeInput, placeCues, splitBlockAtChar, stretchVideoUnder, updateBlock, upsertBlock,
} from '../_lib/ops';
import { C, Btn, Field, Input, Select, Slider } from './ui';

export interface VoiceDefaults { voice_id: string; voice_name?: string; voice_source: VoiceSource; model_id: string; settings: VoiceSettings }
const DEFAULTS_KEY = 'studio.voiceDefaults.v2';
export function loadVoiceDefaults(): VoiceDefaults | null {
  try { const raw = localStorage.getItem(DEFAULTS_KEY); return raw ? (JSON.parse(raw) as VoiceDefaults) : null; } catch { return null; }
}
function saveVoiceDefaults(d: VoiceDefaults) { try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); } catch { /* private mode */ } }

type Group = { label: string; source: VoiceSource; voices: Voice[] };
type Gen = { state: 'idle' | 'busy' | 'error'; message?: string; code?: string };

interface Props {
  projectId: string;
  workspaceId: string | null;
  language: string | null;
  timeline: VoiceoverTimeline;
  time: number;
  voices: VoicesResponse | null;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  update: (fn: (t: VoiceoverTimeline) => VoiceoverTimeline, opts?: { coalesce?: string }) => void;
  onSeek: (t: number) => void;
  onPlayFrom: (t: number) => void;
  onOpenSettings: () => void;
  onVoicesChanged: () => void;
  /** Generate every pending block once the voices load (opened with ?autogen=1 after localizing). */
  autoGenerate?: boolean;
  /** Save now — presenter takes are made from the saved project. */
  beforePresenter?: () => Promise<void>;
}

const PRESENTER_POLL_MS = 6000;
type PresenterState = 'off' | 'blocked' | 'making' | 'ready' | 'todo';

/** Where a block's presenter take stands (and why not, when it can't be made yet). */
function presenterState(b: VoiceBlock, look: VoiceoverPresenter, t: Pick<VoiceoverTimeline, 'clips' | 'output'>): { state: PresenterState; problem: string | null } {
  if (!b.presenter?.on) return { state: 'off', problem: null };
  if (b.presenter.run_id) return { state: 'making', problem: null };
  if (presenterClipFor(b, look, presenterFrame(t, b))) return { state: 'ready', problem: null };
  const problem = blockIsStale(b) ? 'Regenerate the voice first' : presenterBlockProblem(b, look);
  return problem ? { state: 'blocked', problem } : { state: 'todo', problem: null };
}

export function VoicePanel(p: Props) {
  const { timeline, voices } = p;
  const [defaults, setDefaults] = useState<VoiceDefaults | null>(null);
  const [gen, setGen] = useState<Record<string, Gen>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const [consentFor, setConsentFor] = useState<{ block: VoiceBlock; voice_name: string } | null>(null);
  const cancelBulk = useRef(false);
  const autoRan = useRef(false);

  const groups = useMemo<Group[]>(() => {
    if (!voices) return [];
    const g: Group[] = [];
    if (voices.user.voices.length) g.push({ label: `My ElevenLabs voices (…${voices.user.last4 ?? ''})`, source: 'user', voices: voices.user.voices });
    if (voices.workspace?.voices.length) g.push({ label: `${voices.workspace.name} voices`, source: 'workspace', voices: voices.workspace.voices });
    if (voices.platform.voices.length) g.push({ label: 'Vantly voices', source: 'platform', voices: voices.platform.voices });
    return g;
  }, [voices]);

  useEffect(() => {
    if (!voices || defaults) return;
    const saved = loadVoiceDefaults();
    const all = groups.flatMap((g) => g.voices.map((v) => ({ v, s: g.source })));
    if (saved && all.some((x) => x.v.voice_id === saved.voice_id && x.s === saved.voice_source)) { setDefaults(saved); return; }
    const first = all[0];
    setDefaults({ voice_id: first?.v.voice_id ?? '', voice_name: first?.v.name, voice_source: first?.s ?? 'platform', model_id: voices.models.find((m) => m.model_id === 'eleven_multilingual_v2')?.model_id ?? voices.models[0]?.model_id ?? 'eleven_multilingual_v2', settings: VoiceSettingsSchema.parse({}) });
  }, [voices, defaults, groups]);

  const setDefault = (patch: Partial<VoiceDefaults>) => setDefaults((d) => { const n = { ...(d as VoiceDefaults), ...patch }; saveVoiceDefaults(n); return n; });
  const blockDefaults = (): Partial<VoiceBlock> => (defaults ? { voice_id: defaults.voice_id, voice_name: defaults.voice_name, voice_source: defaults.voice_source as VoiceBlock['voice_source'], model_id: defaults.model_id, settings: defaults.settings } : {});

  const blocks = timeline.blocks;
  const pending = blocks.filter((b) => b.text.trim() && (!b.audio_url || blockIsStale(b)) && b.voice_id);
  const charges = voices?.pricing.charges ?? true;
  const pendingCredits = pending.filter((b) => b.voice_source === 'platform').reduce((s, b) => s + quoteVoiceoverTtsCredits(b.text.trim().length), 0);

  async function generate(b: VoiceBlock, all: VoiceBlock[] = blocks): Promise<{ ok: boolean; code?: string }> {
    if (!b.text.trim()) return { ok: false };
    if (!b.voice_id) { setGen((g) => ({ ...g, [b.id]: { state: 'error', message: 'Pick a voice first.' } })); return { ok: false }; }
    setGen((g) => ({ ...g, [b.id]: { state: 'busy' } }));
    const sorted = [...all].sort((a, z) => a.start - z.start);
    const i = sorted.findIndex((x) => x.id === b.id);
    try {
      const r = await studioApi.tts({
        project_id: p.projectId, block_id: b.id, text: b.text.trim(), voice_id: b.voice_id, voice_source: b.voice_source, model_id: b.model_id, settings: b.settings,
        previous_text: sorted[i - 1]?.text.trim().slice(-1000) || undefined, next_text: sorted[i + 1]?.text.trim().slice(0, 1000) || undefined,
        language_code: p.language ?? undefined,
      });
      p.update((t) => updateBlock(t, b.id, {
        audio_url: r.audio_url, audio_duration: r.audio_duration, words: r.words, take_id: r.take_id, generated_text: b.text, generated_voice_id: b.voice_id, audio_in: 0, audio_out: null,
        // Keep the previous generation as a take for A/B.
        takes: b.audio_url && b.take_id && b.audio_duration
          ? [{ take_id: b.take_id, audio_url: b.audio_url, audio_duration: b.audio_duration, words: b.words, text: b.generated_text ?? b.text, voice_name: b.voice_name, created_at: new Date().toISOString() }, ...b.takes].slice(0, 10)
          : b.takes,
      }));
      setGen((g) => ({ ...g, [b.id]: { state: 'idle' } }));
      return { ok: true };
    } catch (e) {
      const err = e as StudioApiError;
      setGen((g) => ({ ...g, [b.id]: { state: 'error', message: err.message, code: err.code } }));
      if (err.code === 'CONSENT_REQUIRED') setConsentFor({ block: b, voice_name: String(err.extra?.voice_name ?? b.voice_name ?? 'this voice') });
      return { ok: false, code: err.code };
    }
  }

  // ── Presenter takes ──
  const look = timeline.presenter;
  const [presenterErr, setPresenterErr] = useState<Record<string, string>>({});
  const [presenterBusy, setPresenterBusy] = useState(false);
  const presenterTodo = blocks.filter((b) => presenterState(b, look, timeline).state === 'todo');
  const presenterTodoCredits = presenterTodo.reduce((s, b) => s + quotePresenterCredits(blockAudioLength(b)), 0);
  const making = blocks.filter((b) => b.presenter?.run_id).map((b) => `${b.id}:${b.presenter!.run_id}`).join(',');

  async function makePresenter(ids: string[], remake = false) {
    if (!ids.length) return;
    setPresenterBusy(true);
    setPresenterErr((e) => { const n = { ...e }; ids.forEach((i) => delete n[i]); return n; });
    try {
      await p.beforePresenter?.();
      const r = await studioApi.startPresenter(p.projectId, ids, remake);
      const run = new Map(r.takes.map((t) => [t.block_id, t.run_id]));
      const done = new Map(r.cached.map((c) => [c.block_id, c]));
      p.update((t) => ({
        ...t,
        blocks: t.blocks.map((b) => {
          const c = done.get(b.id);
          if (c) return { ...b, presenter: { on: true, clip_url: c.clip_url, clip_key: c.clip_key, run_id: null } };
          const id = run.get(b.id);
          return id ? { ...b, presenter: { on: true, clip_url: b.presenter?.clip_url ?? null, clip_key: b.presenter?.clip_key ?? null, run_id: id } } : b;
        }),
      }));
    } catch (e) {
      const err = e as StudioApiError;
      const target = (err.extra?.block_id as string | undefined) ?? ids[0];
      setPresenterErr((m) => ({ ...m, [target]: err.message }));
    } finally {
      setPresenterBusy(false);
    }
  }

  // Poll takes in flight; a finished take is written onto its block (and cached there for every later render).
  useEffect(() => {
    if (!making) return;
    const runs = making.split(',').map((x) => { const [blockId, runId] = x.split(':'); return { blockId, runId }; });
    const iv = setInterval(() => {
      for (const { blockId, runId } of runs) {
        studioApi.presenterStatus(runId).then((st) => {
          if (st.status === 'succeeded' && st.clip_url) {
            p.update((t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === blockId && b.presenter?.run_id === runId ? { ...b, presenter: { on: true, clip_url: st.clip_url, clip_key: st.clip_key, run_id: null } } : b)) }));
          } else if (st.status === 'failed') {
            p.update((t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === blockId && b.presenter?.run_id === runId ? { ...b, presenter: { ...b.presenter, run_id: null } } : b)) }));
            setPresenterErr((m) => ({ ...m, [blockId]: st.error?.message ?? 'The presenter take failed. Any credits were refunded.' }));
          }
        }).catch(() => { /* transient: next tick */ });
      }
    }, PRESENTER_POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [making]);

  async function generateAll() {
    cancelBulk.current = false;
    const queue = [...pending].sort((a, z) => a.start - z.start);
    setBulk({ done: 0, total: queue.length });
    for (let i = 0; i < queue.length; i++) {
      if (cancelBulk.current) break;
      const r = await generate(queue[i]);
      setBulk({ done: i + 1, total: queue.length });
      if (!r.ok && ['INSUFFICIENT_CREDITS', 'KEY_REJECTED', 'NOT_CONFIGURED', 'BUDGET_EXCEEDED', 'CONSENT_REQUIRED'].includes(r.code ?? '')) break;
    }
    setBulk(null);
  }

  useEffect(() => {
    if (!p.autoGenerate || autoRan.current || !voices || !defaults || !pending.length || !p.canEdit) return;
    autoRan.current = true;
    void generateAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoGenerate, voices, defaults, pending.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold" style={{ color: C.text }}>Voice-over script</p>
          {p.language ? <span className="rounded px-1.5 text-[10px] uppercase" style={{ background: C.bg, color: C.muted }}>{p.language}</span> : null}
          <button type="button" onClick={p.onOpenSettings} className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: C.muted }}>
            <Settings2 className="h-3.5 w-3.5" /> {voices?.user.configured ? `My key …${voices.user.last4 ?? ''}` : 'Use my ElevenLabs key'}
          </button>
        </div>
        {voices && !voices.platform.configured && !voices.user.configured && !voices.workspace?.configured ? (
          <div className="rounded-lg p-2 text-[11px]" style={{ background: 'rgba(252,211,77,0.08)', color: '#FCD34D' }}>
            Voices aren&rsquo;t set up on this server. <button type="button" className="underline" onClick={p.onOpenSettings}>Add your ElevenLabs API key</button>.
          </div>
        ) : null}
        {voices?.user.error ? <div className="text-[11px]" style={{ color: '#FCA5A5' }}>{voices.user.error}</div> : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Default voice"><VoiceSelect groups={groups} consented={voices?.consented_voice_ids ?? []} value={defaults ? `${defaults.voice_source}:${defaults.voice_id}` : ''} onChange={(source, v) => setDefault({ voice_id: v.voice_id, voice_name: v.name, voice_source: source })} /></Field>
          <Field label="Model">
            <Select value={defaults?.model_id ?? ''} onChange={(e) => setDefault({ model_id: e.target.value })}>
              {(voices?.models ?? []).map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        {p.canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Btn small onClick={() => { const b = newBlock(p.time, blockDefaults()); p.update((t) => upsertBlock(t, b)); p.onSelect(b.id); }}><Plus className="h-3.5 w-3.5" /> Block at {fmtTime(p.time)}</Btn>
            <Btn small onClick={() => setImportOpen(true)}><FileText className="h-3.5 w-3.5" /> Import</Btn>
            <Btn small title="Push blocks right so none overlaps" onClick={() => p.update(autoSpaceBlocks)}><Wand2 className="h-3.5 w-3.5" /> Auto-space</Btn>
            <Btn small title="How specific words are pronounced" onClick={() => setDictOpen((o) => !o)}><BookA className="h-3.5 w-3.5" /> Pronunciations{timeline.pronunciations.length ? ` · ${timeline.pronunciations.length}` : ''}</Btn>
            {bulk ? (
              <Btn small onClick={() => { cancelBulk.current = true; }}><Loader2 className="h-3.5 w-3.5 animate-spin" /> {bulk.done}/{bulk.total} · Stop</Btn>
            ) : (
              <Btn small primary disabled={!pending.length} onClick={generateAll}><Sparkles className="h-3.5 w-3.5" /> Generate {pending.length || 'all'}{charges && pendingCredits ? ` · ${pendingCredits} cr` : ''}</Btn>
            )}
            {presenterTodo.length ? (
              <Btn small disabled={presenterBusy} title="Make every presenter take that's switched on and not made yet" onClick={() => void makePresenter(presenterTodo.map((b) => b.id))}>
                {presenterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <User className="h-3.5 w-3.5" />} Presenter {presenterTodo.length}{charges ? ` · ${presenterTodoCredits} cr` : ''}
              </Btn>
            ) : null}
          </div>
        ) : null}
        {dictOpen ? <Pronunciations timeline={timeline} update={p.update} /> : null}
      </div>

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
            groups={groups}
            consented={voices?.consented_voice_ids ?? []}
            models={voices?.models ?? []}
            charges={charges}
            canEdit={p.canEdit}
            language={p.language}
            onSelect={() => p.onSelect(b.id)}
            onChange={(patch, coalesce) => p.update((t) => updateBlock(t, b.id, patch), coalesce ? { coalesce: `${coalesce}:${b.id}` } : undefined)}
            onDelete={() => p.update((t) => deleteBlock(t, b.id))}
            onGenerate={(override) => void generate(override ?? b)}
            onSeek={() => p.onSeek(b.start)}
            onPlay={() => p.onPlayFrom(b.start)}
            onSplit={(at) => p.update((t) => splitBlockAtChar(t, b.id, at).timeline)}
            onRegenerateSelection={(s, e) => {
              const t1 = e < b.text.length ? splitBlockAtChar(timeline, b.id, e).timeline : timeline;
              const r2 = s > 0 ? splitBlockAtChar(t1, b.id, s) : { timeline: t1, rightId: b.id };
              p.update(() => autoSpaceBlocks(r2.timeline));
              const mid = r2.timeline.blocks.find((x) => x.id === r2.rightId);
              if (mid) void generate({ ...mid, audio_url: null }, r2.timeline.blocks);
            }}
            onStretchVideo={(extra) => p.update((t) => stretchVideoUnder(t, b.start, extra))}
            onApplyVoiceToAll={() => p.update((t) => ({ ...t, blocks: t.blocks.map((x) => ({ ...x, voice_id: b.voice_id, voice_name: b.voice_name, voice_source: b.voice_source, model_id: b.model_id, settings: b.settings })) }))}
            presenter={presenterState(b, look, timeline)}
            presenterError={presenterErr[b.id] ?? null}
            presenterBusy={presenterBusy}
            onPresenterToggle={(on) => p.update((t) => updateBlock(t, b.id, { presenter: { clip_url: null, clip_key: null, run_id: null, ...b.presenter, on } }))}
            onMakePresenter={(remake) => void makePresenter([b.id], remake)}
          />
        ))}
      </div>

      {importOpen ? (
        <ImportDialog time={p.time} hasBlocks={blocks.length > 0} onClose={() => setImportOpen(false)}
          onImport={(raw, mode) => {
            const placed = placeCues(parseScript(raw), mode === 'append' ? p.time : 0, blockDefaults());
            p.update((t) => placed.reduce((acc, b) => upsertBlock(acc, b), mode === 'replace' ? { ...t, blocks: [] } : t));
            setImportOpen(false);
          }} />
      ) : null}
      {consentFor ? (
        <ConsentDialog block={consentFor.block} voiceName={consentFor.voice_name} workspaceId={p.workspaceId}
          onClose={() => setConsentFor(null)}
          onDone={() => { const b = consentFor.block; setConsentFor(null); p.onVoicesChanged(); void generate(b); }} />
      ) : null}
    </div>
  );
}

function VoiceSelect({ groups, consented, value, onChange }: { groups: Group[]; consented: string[]; value: string; onChange: (source: VoiceSource, v: Voice) => void }) {
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [s, id] = value.split(':');
  const current = groups.find((g) => g.source === s)?.voices.find((v) => v.voice_id === id) ?? null;
  return (
    <div className="flex items-center gap-1">
      <Select value={value} onChange={(e) => {
        const [src, vid] = e.target.value.split(':');
        const v = groups.find((g) => g.source === src)?.voices.find((x) => x.voice_id === vid);
        if (v) onChange(src as VoiceSource, v);
      }}>
        {!current ? <option value="">Choose a voice…</option> : null}
        {groups.map((g) => (
          <optgroup key={g.source} label={g.label}>
            {g.voices.map((v) => {
              const clone = v.category === 'cloned' || v.category === 'professional';
              return <option key={v.voice_id} value={`${g.source}:${v.voice_id}`}>{v.name}{clone ? (consented.includes(v.voice_id) ? ' ★ ✓' : ' ★') : ''}{v.labels?.accent ? ` · ${v.labels.accent}` : ''}</option>;
            })}
          </optgroup>
        ))}
      </Select>
      {current?.preview_url ? (
        <button type="button" title="Hear a sample" className="shrink-0 rounded-md p-1.5" style={{ border: `1px solid ${C.line2}`, color: C.muted }}
          onClick={() => { previewRef.current?.pause(); previewRef.current = new Audio(current.preview_url!); void previewRef.current.play().catch(() => {}); }}>
          <Volume2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function BlockCard(p: {
  b: VoiceBlock; room: number; selected: boolean; gen: Gen; groups: Group[]; consented: string[]; models: { model_id: string; name: string }[];
  charges: boolean; canEdit: boolean; language: string | null;
  onSelect: () => void; onChange: (patch: Partial<VoiceBlock>, coalesce?: string) => void; onDelete: () => void;
  onGenerate: (override?: VoiceBlock) => void; onSeek: () => void; onPlay: () => void; onSplit: (at: number) => void;
  onRegenerateSelection: (s: number, e: number) => void; onStretchVideo: (extra: number) => void; onApplyVoiceToAll: () => void;
  presenter: { state: PresenterState; problem: string | null }; presenterError: string | null; presenterBusy: boolean;
  onPresenterToggle: (on: boolean) => void; onMakePresenter: (remake?: boolean) => void;
}) {
  const { b } = p;
  const [showSettings, setShowSettings] = useState(false);
  const [startText, setStartText] = useState(fmtTime(b.start));
  const [sel, setSel] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [shortening, setShortening] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setStartText(fmtTime(b.start)), [b.start]);
  const dur = blockDuration(b);
  const fits = dur <= p.room + 0.05;
  const over = dur - p.room;
  const staleReason = blockStaleReason(b);
  const stale = staleReason !== null;
  const chars = b.text.trim().length;
  const cost = p.charges && b.voice_source === 'platform' ? quoteVoiceoverTtsCredits(chars) : 0;
  const ratio = p.room > 0 ? dur / p.room : 99;

  const insertAtCursor = (snippet: string) => {
    const at = taRef.current?.selectionStart ?? b.text.length;
    p.onChange({ text: b.text.slice(0, at) + snippet + b.text.slice(at) });
  };
  // Which take is playing: 0 = current, n = takes[n-1]
  const swapTake = (i: number) => {
    const t = b.takes[i];
    if (!t || !b.audio_url || !b.take_id || !b.audio_duration) return;
    const cur = { take_id: b.take_id, audio_url: b.audio_url, audio_duration: b.audio_duration, words: b.words, text: b.generated_text ?? b.text, voice_name: b.voice_name, created_at: new Date().toISOString() };
    const takes = [...b.takes];
    takes.splice(i, 1, cur);
    p.onChange({ audio_url: t.audio_url, audio_duration: t.audio_duration, words: t.words, take_id: t.take_id, generated_text: t.text, generated_voice_id: null, text: t.text, audio_in: 0, audio_out: null, takes });
  };

  return (
    <div data-block={b.id} onClick={p.onSelect} className="rounded-xl p-2.5" style={{ background: p.selected ? '#1B1C2A' : C.card, border: `1px solid ${p.selected ? 'rgba(167,139,250,0.5)' : C.line}` }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}>
        <input value={startText} onChange={(e) => setStartText(e.target.value)} disabled={!p.canEdit}
          onBlur={() => { const v = parseTimeInput(startText); if (v !== null) p.onChange({ start: Math.max(0, v) }); else setStartText(fmtTime(b.start)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-14 rounded px-1 py-0.5 font-mono outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} title="Start time (m:ss.s)" />
        <button type="button" onClick={(e) => { e.stopPropagation(); p.onSeek(); }} className="hover:underline">jump</button>
        <span className="ml-1 inline-flex items-center gap-1" style={{ color: fits ? '#6EE7B7' : '#FCA5A5' }} title="Narration length vs. room before the next block">
          {fits ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{b.audio_url ? '' : '~'}{dur.toFixed(1)}s / {p.room.toFixed(1)}s
        </span>
        <span className="ml-auto">{!b.audio_url ? 'not generated' : stale ? <span style={{ color: '#FCD34D' }}>{staleReason === 'voice' ? 'voice changed' : 'text changed'}</span> : <span style={{ color: '#6EE7B7' }}>generated</span>}</span>
      </div>

      <textarea ref={taRef} value={b.text} readOnly={!p.canEdit}
        onChange={(e) => p.onChange({ text: e.target.value }, 'text')}
        onSelect={(e) => { const t = e.target as HTMLTextAreaElement; setSel({ s: t.selectionStart, e: t.selectionEnd }); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); p.onGenerate(); } }}
        rows={Math.min(8, Math.max(2, Math.ceil(b.text.length / 48)))} placeholder="What should the narrator say over this part?"
        className="w-full resize-y rounded-lg px-2 py-1.5 text-[13px] leading-snug outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} />

      {p.selected && p.canEdit ? (
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5" style={{ border: `1px solid ${C.line2}`, color: C.muted }} onClick={(e) => { e.stopPropagation(); insertAtCursor(' <break time="0.5s" /> '); }}><PauseIcon className="h-3 w-3" /> Pause</button>
          <button type="button" disabled={sel.s <= 0 || sel.s >= b.text.length} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 disabled:opacity-30" style={{ border: `1px solid ${C.line2}`, color: C.muted }} onClick={(e) => { e.stopPropagation(); p.onSplit(sel.s); }} title="Split into two blocks at the cursor (keeps the generated audio)"><Scissors className="h-3 w-3" /> Split here</button>
          <button type="button" disabled={sel.e - sel.s < 2 || !b.audio_url} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 disabled:opacity-30" style={{ border: `1px solid ${C.line2}`, color: C.muted }} onClick={(e) => { e.stopPropagation(); p.onRegenerateSelection(sel.s, sel.e); }} title="Select a phrase, regenerate only that part"><Sparkles className="h-3 w-3" /> Regenerate selection</button>
          {b.audio_url && b.takes.length ? (
            <span className="ml-auto inline-flex items-center gap-1" style={{ color: C.muted }}>
              takes:
              {b.takes.map((t, i) => (
                <button key={t.take_id} type="button" className="rounded px-1" style={{ border: `1px solid ${C.line2}` }} title={`Swap in take from ${new Date(t.created_at).toLocaleTimeString()}${t.voice_name ? ` (${t.voice_name})` : ''}`} onClick={(e) => { e.stopPropagation(); swapTake(i); }}>
                  <ChevronLeft className="inline h-2.5 w-2.5" />{i + 2}<ChevronRight className="inline h-2.5 w-2.5" />
                </button>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      {!fits && p.canEdit && b.text.trim() ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-lg p-1.5 text-[10px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5' }}>
          <span>{over.toFixed(1)}s too long. Fit it:</span>
          {ratio <= 1.2 ? <button type="button" className="rounded px-1.5 py-0.5 underline" onClick={(e) => { e.stopPropagation(); const speed = Math.min(1.2, Math.round(b.settings.speed * ratio * 100) / 100 + 0.01); const nb = { ...b, settings: { ...b.settings, speed } }; p.onChange({ settings: nb.settings }); p.onGenerate(nb); }}>speak faster</button> : null}
          <button type="button" disabled={shortening} className="rounded px-1.5 py-0.5 underline" onClick={async (e) => {
            e.stopPropagation(); setShortening(true);
            try { const r = await studioApi.shorten({ text: b.text, target_seconds: Math.max(1, p.room - 0.2), language: p.language ?? undefined }); p.onChange({ text: r.text }); } catch { /* shown via no change */ } finally { setShortening(false); }
          }}>{shortening ? 'shortening…' : 'shorten with AI'}</button>
          <button type="button" className="rounded px-1.5 py-0.5 underline" onClick={(e) => { e.stopPropagation(); p.onStretchVideo(over + 0.3); }}>slow the video under it</button>
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="min-w-0 flex-1"><VoiceSelect groups={p.groups} consented={p.consented} value={`${b.voice_source}:${b.voice_id}`} onChange={(source, v) => p.onChange({ voice_id: v.voice_id, voice_name: v.name, voice_source: source as VoiceBlock['voice_source'] })} /></div>
        <button type="button" title="Voice settings" onClick={(e) => { e.stopPropagation(); setShowSettings((s) => !s); }} className="rounded-md p-1.5" style={{ border: `1px solid ${C.line2}`, color: C.muted }}>
          <ChevronDown className="h-3.5 w-3.5" style={{ transform: showSettings ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>

      {showSettings ? (
        <div className="mt-2 space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
          <Field label="Model"><Select value={b.model_id} onChange={(e) => p.onChange({ model_id: e.target.value })}>{p.models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}</Select></Field>
          <Slider label="Speed" min={0.7} max={1.2} step={0.01} value={b.settings.speed} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => p.onChange({ settings: { ...b.settings, speed: v } }, 'speed')} />
          <Slider label="Stability" hint="lower = more expressive" min={0} max={1} step={0.01} value={b.settings.stability} onChange={(v) => p.onChange({ settings: { ...b.settings, stability: v } }, 'stab')} />
          <Slider label="Similarity" min={0} max={1} step={0.01} value={b.settings.similarity_boost} onChange={(v) => p.onChange({ settings: { ...b.settings, similarity_boost: v } }, 'sim')} />
          <Slider label="Style exaggeration" min={0} max={1} step={0.01} value={b.settings.style} onChange={(v) => p.onChange({ settings: { ...b.settings, style: v } }, 'style')} />
          <Slider label="Block volume" min={0} max={2} step={0.05} value={b.volume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => p.onChange({ volume: v }, 'vol')} />
          <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={b.settings.use_speaker_boost} onChange={(e) => p.onChange({ settings: { ...b.settings, use_speaker_boost: e.target.checked } })} /> Speaker boost</label>
          <button type="button" className="text-[11px] underline" style={{ color: C.muted }} onClick={p.onApplyVoiceToAll}>Use this voice & settings for every block</button>
        </div>
      ) : null}

      {p.canEdit ? (
        <div className="mt-1.5 flex min-h-[24px] items-center gap-1.5 text-[11px]" style={{ color: C.muted }}>
          <label className="inline-flex cursor-pointer items-center gap-1" title="Show you, lip-synced to this line, in a corner circle" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={p.presenter.state !== 'off'} onChange={(e) => p.onPresenterToggle(e.target.checked)} /> <User className="h-3 w-3" /> Presenter
          </label>
          {p.presenter.state === 'blocked' ? <span style={{ color: '#FCD34D' }}>{p.presenter.problem}</span> : null}
          {p.presenter.state === 'making' ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> making (2–6 min)</span> : null}
          {p.presenter.state === 'ready' ? (
            <>
              <span style={{ color: '#6EE7B7' }}>ready</span>
              <button type="button" disabled={p.presenterBusy} className="ml-auto underline disabled:opacity-40" title={`Not happy with this take? Make a new one${p.charges ? ` (${quotePresenterCredits(blockAudioLength(b))} cr)` : ''}`}
                onClick={(e) => { e.stopPropagation(); p.onMakePresenter(true); }}>Remake</button>
            </>
          ) : null}
          {p.presenter.state === 'todo' ? (
            <span className="ml-auto">
              <Btn small primary disabled={p.presenterBusy} onClick={(e) => { e.stopPropagation(); p.onMakePresenter(); }}>
                <User className="h-3.5 w-3.5" /> Make · {presenterTakeSeconds(blockAudioLength(b))}s{p.charges ? ` · ${quotePresenterCredits(blockAudioLength(b))} cr` : ''}
              </Btn>
            </span>
          ) : null}
        </div>
      ) : null}
      {p.presenterError ? <div className="mt-1 text-[11px]" style={{ color: '#FCA5A5' }}>{p.presenterError}</div> : null}

      {p.gen.state === 'error' ? (
        <div className="mt-1.5 text-[11px]" style={{ color: '#FCA5A5' }}>
          {p.gen.message} {p.gen.code === 'INSUFFICIENT_CREDITS' ? <Link href="/dashboard/billing" className="underline">Top up</Link> : null}
        </div>
      ) : null}

      {p.canEdit ? (
        <div className="mt-2 flex items-center gap-1.5">
          <Btn small primary={!b.audio_url || stale} disabled={!chars || p.gen.state === 'busy'} onClick={(e) => { e.stopPropagation(); p.onGenerate(); }}>
            {p.gen.state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{b.audio_url ? 'Regenerate' : 'Generate'}{cost ? ` · ${cost} cr` : ''}
          </Btn>
          <Btn small disabled={!b.audio_url} onClick={(e) => { e.stopPropagation(); p.onPlay(); }}><Play className="h-3.5 w-3.5" /> Play</Btn>
          <span className="ml-auto text-[10px]" style={{ color: C.faint }}>{chars} chars</span>
          <button type="button" title="Delete block" onClick={(e) => { e.stopPropagation(); p.onDelete(); }} className="rounded p-1" style={{ color: '#FCA5A5' }}><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
    </div>
  );
}

function Pronunciations({ timeline, update }: { timeline: VoiceoverTimeline; update: Props['update'] }) {
  const [word, setWord] = useState('');
  const [alias, setAlias] = useState('');
  const [ipa, setIpa] = useState(false);
  return (
    <div className="space-y-1.5 rounded-lg p-2" style={{ background: C.bg }}>
      <p className="text-[10px]" style={{ color: C.faint }}>Applied to every generation in this project (ElevenLabs pronunciation dictionary). Use “sounds like” spelling, or IPA.</p>
      {timeline.pronunciations.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px]" style={{ color: C.text }}>
          <b>{r.word}</b><span style={{ color: C.muted }}>→</span><span className="font-mono">{r.phoneme ? `/${r.phoneme}/` : r.alias}</span>
          <button type="button" className="ml-auto" style={{ color: '#FCA5A5' }} onClick={() => update((t) => ({ ...t, pronunciations: t.pronunciations.filter((_, j) => j !== i) }))}><Trash2 className="h-3 w-3" /></button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input placeholder="TheSkillPedia" value={word} onChange={(e) => setWord(e.target.value)} />
        <Input placeholder={ipa ? 'ðə skɪl ˈpiːdiə' : 'The Skill Pedia'} value={alias} onChange={(e) => setAlias(e.target.value)} />
        <label className="flex items-center gap-0.5 text-[10px]" style={{ color: C.muted }}><input type="checkbox" checked={ipa} onChange={(e) => setIpa(e.target.checked)} />IPA</label>
        <Btn small disabled={!word.trim() || !alias.trim()} onClick={() => { update((t) => ({ ...t, pronunciations: [...t.pronunciations.filter((r) => r.word !== word.trim()), { word: word.trim(), alias: ipa ? '' : alias.trim(), phoneme: ipa ? alias.trim() : '' }] })); setWord(''); setAlias(''); }}><Plus className="h-3 w-3" /></Btn>
      </div>
    </div>
  );
}

function ConsentDialog({ block, voiceName, workspaceId, onClose, onDone }: { block: VoiceBlock; voiceName: string; workspaceId: string | null; onClose: () => void; onDone: () => void }) {
  const [speaker, setSpeaker] = useState('');
  const [statement, setStatement] = useState(`I confirm that the person whose voice was used to create "${voiceName}" has given informed, written or recorded consent for it to be used to narrate videos produced with Vantly Voiceover Studio.`);
  const [attest, setAttest] = useState(false);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const forWorkspace = block.voice_source === 'workspace';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.line2}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" style={{ color: C.accent }} /><p className="text-sm font-semibold" style={{ color: C.text }}>Consent for a cloned voice</p><button type="button" className="ml-auto" onClick={onClose} style={{ color: C.muted }}><X className="h-4 w-4" /></button></div>
        <p className="text-xs" style={{ color: C.muted }}>“{voiceName}” is a cloned voice. Record the speaker&rsquo;s consent once{forWorkspace ? ' for your workspace' : ''}; it&rsquo;s kept in the audit trail and referenced in every export&rsquo;s provenance manifest.</p>
        <Field label="Speaker's full name"><Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="e.g. Ram Niwas Sangwan" /></Field>
        <Field label="Consent statement"><textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} className="w-full rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} /></Field>
        <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: C.muted }}>
          <input type="file" accept="audio/*,image/png,image/jpeg" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return; setBusy(true);
            try { const raw = await uploadDirect(f, { workspaceId }); setEvidence((await studioApi.asset({ kind: 'evidence', url: raw })).url); } catch (er) { setErr((er as Error).message); } finally { setBusy(false); }
          }} />
          <span className="underline">{evidence ? 'Evidence attached ✓' : 'Attach evidence (recorded statement or signed form) — optional'}</span>
        </label>
        <label className="flex items-start gap-2 text-[11px]" style={{ color: C.text }}><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5" /> I attest this is true. False attestations violate the terms of service.</label>
        {err ? <p className="text-xs" style={{ color: '#FCA5A5' }}>{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!attest || speaker.trim().length < 2 || statement.trim().length < 20 || busy} onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await studioApi.addConsent({ voice_id: block.voice_id, voice_name: voiceName, voice_source: forWorkspace ? 'workspace' : 'user', speaker_name: speaker.trim(), statement: statement.trim(), evidence_url: evidence, workspace_id: forWorkspace ? workspaceId : null });
              onDone();
            } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record consent & generate</Btn>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({ time, hasBlocks, onClose, onImport }: { time: number; hasBlocks: boolean; onClose: () => void; onImport: (raw: string, mode: 'replace' | 'append') => void }) {
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>(hasBlocks ? 'append' : 'replace');
  const cues = useMemo(() => parseScript(raw), [raw]);
  const timed = cues.filter((c) => c.start !== null).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.line2}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center"><p className="text-sm font-semibold" style={{ color: C.text }}>Import narration</p><button type="button" className="ml-auto" onClick={onClose} style={{ color: C.muted }}><X className="h-4 w-4" /></button></div>
        <p className="mb-2 text-xs" style={{ color: C.muted }}>Paste a script (one block per paragraph), an <b>ElevenLabs cue sheet</b> (<code>CUE 1 | start 0:00.0 | …</code>) or an <b>.srt</b>. Timed cues land at their times; the rest follow one after another.</p>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10} className="w-full rounded-lg p-2 font-mono text-xs outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }}
          placeholder={'What if you could watch a course before paying?\n\nThe Courses page lists everything…'} />
        <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: C.muted }}>
          <label className="cursor-pointer underline">or choose a file<input type="file" accept=".txt,.md,.srt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRaw(await f.text()); }} /></label>
          <span className="ml-auto">{cues.length} blocks{timed ? ` · ${timed} timed` : ''}</span>
        </div>
        {hasBlocks ? (
          <div className="mt-3 flex gap-4 text-xs" style={{ color: C.text }}>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add at playhead ({fmtTime(time)})</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace all blocks</label>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!cues.length} onClick={() => onImport(raw, mode)}>Import {cues.length || ''} blocks</Btn></div>
      </div>
    </div>
  );
}
