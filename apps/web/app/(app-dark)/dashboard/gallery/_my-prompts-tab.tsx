// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * My Prompts tab of /dashboard/gallery — a guided, non-technical-friendly
 * way to build and SAVE a reusable make_ugc preset. This tab creates and
 * edits prompts; it never runs them. A saved prompt is picked up and run
 * from the agent chat instead — /dashboard/agent's "+" menu has a "Use a
 * saved prompt" option that lists everything saved here and drops the
 * chosen one into the chat composer as a normal message, so running a
 * prompt always goes through the same confirm-before-spend agent flow
 * every other generation does.
 *
 * Every field maps directly onto MakeUgcSkillInputSchema (services/api-v2/
 * src/skills/registry.ts), same as before:
 *   - "I want to generate" is a helper-only pitch, used to draft a script
 *     via POST /v1/assist/draft-script — it is NEVER sent to make_ugc itself.
 *   - "Script" is `script`. Always shown as an editable textarea, whether
 *     typed by hand or drafted by AI, so the user can add their own
 *     personal touch before saving.
 *   - "Person" resolves to exactly one of `person` (free text), `character`
 *     (a saved character's character_sheet_url), or `image` (a stock
 *     actor's portrait_url, or an uploaded photo) — matching the schema's
 *     "at most one of person/image/character" rule structurally, by
 *     construction, rather than by validating it after the fact.
 *   - "Look" is `look` (natural/commercial/raw_iphone).
 *   - "Aspect ratio" is `aspect_ratio` (9:16 default, or 1:1).
 *   - Everything else the schema accepts (name hint, captions, music,
 *     broll_url) lives under a collapsed "Advanced" section so the default
 *     view stays simple.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Wand2, Save, Users, ChevronDown, Info, UploadCloud, Trash2, Pencil, Plus, X,
} from 'lucide-react';

type Look = 'natural' | 'commercial' | 'raw_iphone';
type AspectRatio = '9:16' | '1:1';
type CaptionStyle = 'hormozi' | 'tiktok' | 'minimal';
type PersonMode = 'describe' | 'my-character' | 'stock-actor' | 'upload';
type DraftLength = '5' | '10' | '15' | 'auto';

interface SavedCharacter { id: string; name: string | null; character_sheet_url: string | null; thumbnail_url: string | null }
interface StockActor { id: string; name: string; portrait_url: string | null }

interface SavedPrompt {
  id: string;
  name: string;
  pitch: string | null;
  script: string;
  person_mode: PersonMode;
  person_text: string | null;
  person_ref_id: string | null;
  person_ref_name: string | null;
  person_image_url: string | null;
  look: Look;
  aspect_ratio: AspectRatio;
  name_hint: string | null;
  captions: boolean;
  caption_style: CaptionStyle;
  music: boolean;
  music_text: string | null;
  broll_url: string | null;
  updated_at: string;
}

const LOOK_OPTIONS: { value: Look; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'Warm and casual, soft daylight — like talking to a friend.' },
  { value: 'commercial', label: 'Commercial', hint: 'Polished and confident, brand-ready, still conversational.' },
  { value: 'raw_iphone', label: 'Raw / iPhone', hint: 'Unpolished, shot-on-phone energy — the opposite of produced.' },
];

const ASPECT_OPTIONS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '9:16', label: '9:16 vertical', hint: 'TikTok, Reels, Shorts — the default for UGC.' },
  { value: '1:1', label: '1:1 square', hint: 'Square feed posts.' },
];

const DRAFT_LENGTH_OPTIONS: { value: DraftLength; label: string }[] = [
  { value: 'auto', label: 'Let AI decide' },
  { value: '5', label: '~5s punchy line' },
  { value: '10', label: '~10s one beat' },
  { value: '15', label: '~15s hook + detail' },
];

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 inline-flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.4)' }}>
      <Info className="mt-[1px] h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
      {children}
      {required ? <span style={{ color: '#A78BFA' }}> *</span> : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' };

export function MyPromptsTab() {
  // ── Saved-prompt library (list + which one, if any, is loaded for editing) ──
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [promptsErr, setPromptsErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const r = await fetch('/api/dashboard/prompts', { credentials: 'include' });
      const j = r.ok ? ((await r.json()) as { prompts?: SavedPrompt[] }) : { prompts: [] };
      setPrompts(j.prompts ?? []);
      if (!r.ok) setPromptsErr('Could not load your saved prompts.');
    } catch {
      setPrompts([]);
      setPromptsErr('Could not load your saved prompts.');
    }
  }, []);
  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  // ── Form fields (a new, blank prompt until a saved one is loaded) ──
  const [promptName, setPromptName] = useState('');

  const [pitch, setPitch] = useState('');
  const [draftLength, setDraftLength] = useState<DraftLength>('auto');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);

  const [script, setScript] = useState('');

  const [personMode, setPersonMode] = useState<PersonMode>('describe');
  const [personText, setPersonText] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState<SavedCharacter | null>(null);
  const [selectedActor, setSelectedActor] = useState<StockActor | null>(null);
  const [uploadDataUrl, setUploadDataUrl] = useState('');

  const [look, setLook] = useState<Look>('natural');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [nameHint, setNameHint] = useState('');
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('hormozi');
  const [musicOn, setMusicOn] = useState(false);
  const [musicText, setMusicText] = useState('');
  const [brollUrl, setBrollUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const draftScript = useCallback(async () => {
    if (!pitch.trim() || drafting) return;
    setDrafting(true);
    setDraftErr(null);
    try {
      const resp = await fetch('/api/v1/assist/draft-script', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitch: pitch.trim(), target_duration: draftLength, look }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? `HTTP ${resp.status}`;
        setDraftErr(typeof msg === 'string' ? msg : 'Could not draft a script.');
        setDrafting(false);
        return;
      }
      const draftedScript = data.script as string | undefined;
      if (draftedScript) setScript(draftedScript);
      setDrafting(false);
    } catch (e) {
      setDraftErr((e as Error).message);
      setDrafting(false);
    }
  }, [pitch, drafting, draftLength, look]);

  function resetForm() {
    setEditingId(null);
    setPromptName('');
    setPitch(''); setDraftLength('auto'); setDraftErr(null);
    setScript('');
    setPersonMode('describe'); setPersonText('');
    setSelectedCharacter(null); setSelectedActor(null); setUploadDataUrl('');
    setLook('natural'); setAspectRatio('9:16');
    setAdvancedOpen(false); setNameHint('');
    setCaptionsOn(false); setCaptionStyle('hormozi');
    setMusicOn(false); setMusicText('');
    setBrollUrl('');
    setSaveErr(null); setSaveOk(false);
  }

  function loadPromptIntoForm(p: SavedPrompt) {
    setEditingId(p.id);
    setPromptName(p.name);
    setPitch(p.pitch ?? '');
    setScript(p.script);
    setPersonMode(p.person_mode);
    setPersonText(p.person_text ?? '');
    setSelectedCharacter(
      p.person_mode === 'my-character' && p.person_ref_id
        ? { id: p.person_ref_id, name: p.person_ref_name, character_sheet_url: p.person_image_url, thumbnail_url: p.person_image_url }
        : null,
    );
    setSelectedActor(
      p.person_mode === 'stock-actor' && p.person_ref_id
        ? { id: p.person_ref_id, name: p.person_ref_name ?? '', portrait_url: p.person_image_url }
        : null,
    );
    setUploadDataUrl(p.person_mode === 'upload' ? (p.person_image_url ?? '') : '');
    setLook(p.look);
    setAspectRatio(p.aspect_ratio);
    setNameHint(p.name_hint ?? '');
    setCaptionsOn(p.captions);
    setCaptionStyle(p.caption_style);
    setMusicOn(p.music);
    setMusicText(p.music_text ?? '');
    setBrollUrl(p.broll_url ?? '');
    setAdvancedOpen(Boolean(p.name_hint || p.captions || p.music || p.broll_url));
    setSaveErr(null); setSaveOk(false);
  }

  const validate = (): string | null => {
    if (!promptName.trim()) return 'Give this prompt a name so you can find it again.';
    if (!script.trim()) return 'Write or draft a script first.';
    if (script.trim().length > 1200) return 'Script is too long — keep it under 1200 characters.';
    if (personMode === 'my-character' && !selectedCharacter) return 'Pick one of your characters, or switch to another Person option.';
    if (personMode === 'stock-actor' && !selectedActor) return 'Pick a stock actor, or switch to another Person option.';
    if (personMode === 'upload' && !uploadDataUrl) return 'Upload a photo, or switch to another Person option.';
    return null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setSaveErr(validationError); setSaveOk(false); return; }
    if (saving) return;
    setSaveErr(null); setSaveOk(false); setSaving(true);

    const body: Record<string, unknown> = {
      name: promptName.trim(),
      pitch: pitch.trim() || null,
      script: script.trim(),
      person_mode: personMode,
      look,
      aspect_ratio: aspectRatio,
      name_hint: nameHint.trim() || null,
      captions: captionsOn,
      caption_style: captionStyle,
      music: musicOn,
      music_text: musicText.trim() || null,
      broll_url: brollUrl.trim() || null,
    };
    if (personMode === 'describe') {
      body.person_text = personText.trim() || null;
    } else if (personMode === 'my-character' && selectedCharacter) {
      body.person_ref_id = selectedCharacter.id;
      body.person_ref_name = selectedCharacter.name;
      body.person_image_url = selectedCharacter.character_sheet_url;
    } else if (personMode === 'stock-actor' && selectedActor) {
      body.person_ref_id = selectedActor.id;
      body.person_ref_name = selectedActor.name;
      body.person_image_url = selectedActor.portrait_url;
    } else if (personMode === 'upload' && uploadDataUrl) {
      if (uploadDataUrl.startsWith('data:')) body.upload_data_url = uploadDataUrl;
      else body.person_image_url = uploadDataUrl;
    }

    try {
      const url = editingId ? `/api/dashboard/prompts/${editingId}` : '/api/dashboard/prompts';
      const method = editingId ? 'PATCH' : 'POST';
      const resp = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? `HTTP ${resp.status}`;
        setSaveErr(typeof msg === 'string' ? msg : 'Could not save this prompt.');
        setSaving(false);
        return;
      }
      const saved = data.prompt as SavedPrompt | undefined;
      if (saved) { setEditingId(saved.id); setSaveOk(true); }
      setSaving(false);
      void loadPrompts();
    } catch (e) {
      setSaveErr((e as Error).message);
      setSaving(false);
    }
  };

  const deletePrompt = async (id: string) => {
    if (!confirm('Delete this saved prompt? This can’t be undone.')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/dashboard/prompts/${id}`, { method: 'DELETE', credentials: 'include' });
      if (id === editingId) resetForm();
      void loadPrompts();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Saved prompts library */}
      <div className="flex flex-col gap-3 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium" style={{ color: '#E9E9F0' }}>Your saved prompts</span>
          {editingId && (
            <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: '#A78BFA' }}>
              <Plus className="h-3.5 w-3.5" /> New prompt
            </button>
          )}
        </div>
        {promptsErr && <p className="text-[12px]" style={{ color: '#FCA5A5' }}>{promptsErr}</p>}
        {prompts === null ? (
          <div className="flex h-10 items-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
        ) : prompts.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Nothing saved yet — build one below, give it a name, and save it. Run it later from the &quot;+&quot; menu on the Agent page.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {prompts.map((p) => {
              const active = p.id === editingId;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ backgroundColor: active ? 'rgba(167,139,250,0.1)' : '#0F1015', border: `1px solid ${active ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.06)'}` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" style={{ color: '#E9E9F0' }}>{p.name}</p>
                    <p className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{p.script}</p>
                  </div>
                  <button type="button" onClick={() => loadPromptIntoForm(p)} aria-label={`Edit ${p.name}`} title="Edit" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-100" style={{ color: 'rgba(255,255,255,0.5)', opacity: 0.8 }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => void deletePrompt(p.id)} disabled={deletingId === p.id} aria-label={`Delete ${p.name}`} title="Delete" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-100 disabled:opacity-40" style={{ color: '#FCA5A5', opacity: 0.8 }}>
                    {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <Callout>Saved prompts don&apos;t run from here — open the Agent page, tap the &quot;+&quot; by the message box, and choose &quot;Use a saved prompt&quot; to generate.</Callout>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-8">
        {/* Prompt name */}
        <div className="flex flex-col gap-2 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <FieldLabel required>{editingId ? 'Editing' : 'New prompt'} — name</FieldLabel>
          <input
            type="text"
            value={promptName}
            onChange={(e) => setPromptName(e.target.value)}
            placeholder="e.g. Coffee shop grand opening"
            maxLength={80}
            className="rounded-lg px-3 py-2.5 text-sm"
            style={inputStyle}
          />
          <Callout>How you&apos;ll find this prompt again in this list, and in the Agent page&apos;s &quot;+&quot; menu.</Callout>
        </div>

        {/* 1. I want to generate */}
        <div className="flex flex-col gap-2 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <FieldLabel>1. I want to generate…</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <input
              type="text"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              placeholder="a coffee shop's grand opening, 20% off this week"
              maxLength={400}
              className="flex-1 rounded-lg px-3 py-2.5 text-sm"
              style={inputStyle}
            />
            <select
              value={draftLength}
              onChange={(e) => setDraftLength(e.target.value as DraftLength)}
              className="rounded-lg px-3 py-2.5 text-sm"
              style={inputStyle}
            >
              {DRAFT_LENGTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              type="button"
              onClick={draftScript}
              disabled={!pitch.trim() || drafting}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium"
              style={{ backgroundColor: !pitch.trim() || drafting ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}
            >
              {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Draft script
            </button>
          </div>
          <Callout>One line is enough — Claude turns it into a spoken script below, which you can then edit however you like.</Callout>
          {draftErr && <p className="text-[12px]" style={{ color: '#FCA5A5' }}>{draftErr}</p>}
        </div>

        {/* 2. Script */}
        <div className="flex flex-col gap-2 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <FieldLabel required>2. Script</FieldLabel>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="What the on-camera person says, word for word…"
            rows={4}
            maxLength={1200}
            className="resize-y rounded-lg px-3 py-2.5 text-sm"
            style={inputStyle}
          />
          <div className="flex items-center justify-between">
            <Callout>This is exactly what gets spoken — make it sound like a real person talking, not an ad.</Callout>
            <span className="shrink-0 pl-3 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{script.trim().length}/1200</span>
          </div>
        </div>

        {/* 3. Person */}
        <div className="flex flex-col gap-3 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <FieldLabel>3. Person</FieldLabel>
          <div className="flex flex-wrap gap-1.5 rounded-full p-1" style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)', width: 'fit-content' }}>
            {([
              ['describe', 'Describe'],
              ['my-character', 'My characters'],
              ['stock-actor', 'Stock actors'],
              ['upload', 'Upload photo'],
            ] as [PersonMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPersonMode(mode)}
                className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
                style={{ backgroundColor: personMode === mode ? '#A78BFA' : 'transparent', color: personMode === mode ? '#0F1015' : 'rgba(255,255,255,0.62)' }}
              >
                {label}
              </button>
            ))}
          </div>

          {personMode === 'describe' && (
            <>
              <input
                type="text"
                value={personText}
                onChange={(e) => setPersonText(e.target.value)}
                placeholder="a friendly 28-year-old woman, soft daylight, candid framing"
                maxLength={400}
                className="rounded-lg px-3 py-2.5 text-sm"
                style={inputStyle}
              />
              <Callout>Leave this blank to let a default AI person be generated for you.</Callout>
            </>
          )}
          {personMode === 'my-character' && (
            <CharacterGrid selected={selectedCharacter?.id ?? null} onSelect={setSelectedCharacter} />
          )}
          {personMode === 'stock-actor' && (
            <ActorGrid selected={selectedActor?.id ?? null} onSelect={setSelectedActor} />
          )}
          {personMode === 'upload' && (
            <PhotoUpload dataUrl={uploadDataUrl} onChange={setUploadDataUrl} />
          )}
        </div>

        {/* 4. Look + 5. Aspect ratio */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
            <FieldLabel>4. Look</FieldLabel>
            <div className="flex flex-col gap-2">
              {LOOK_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2" style={{ backgroundColor: look === o.value ? 'rgba(167,139,250,0.1)' : '#0F1015', border: `1px solid ${look === o.value ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
                  <input type="radio" name="look" checked={look === o.value} onChange={() => setLook(o.value)} className="mt-1" />
                  <span>
                    <span className="block text-[13px] font-medium" style={{ color: '#E9E9F0' }}>{o.label}</span>
                    <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
            <FieldLabel>5. Aspect ratio</FieldLabel>
            <div className="flex flex-col gap-2">
              {ASPECT_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2" style={{ backgroundColor: aspectRatio === o.value ? 'rgba(167,139,250,0.1)' : '#0F1015', border: `1px solid ${aspectRatio === o.value ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
                  <input type="radio" name="aspect" checked={aspectRatio === o.value} onChange={() => setAspectRatio(o.value)} className="mt-1" />
                  <span>
                    <span className="block text-[13px] font-medium" style={{ color: '#E9E9F0' }}>{o.label}</span>
                    <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced (optional) */}
        <div className="rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
          >
            <span className="text-[13px] font-medium" style={{ color: '#E9E9F0' }}>Advanced (optional)</span>
            <ChevronDown className="h-4 w-4 transition-transform" style={{ color: 'rgba(255,255,255,0.5)', transform: advancedOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
          {advancedOpen && (
            <div className="flex flex-col gap-4 border-t px-5 py-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <div className="flex flex-col gap-1">
                <FieldLabel>Name / vibe hint</FieldLabel>
                <input type="text" value={nameHint} onChange={(e) => setNameHint(e.target.value)} placeholder="Maya, 27" maxLength={80} className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px]" style={{ color: '#E9E9F0' }}>
                  <input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.target.checked)} />
                  Burn in captions
                </label>
                {captionsOn && (
                  <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)} className="rounded-lg px-2.5 py-1.5 text-[13px]" style={inputStyle}>
                    <option value="hormozi">Hormozi</option>
                    <option value="tiktok">TikTok</option>
                    <option value="minimal">Minimal</option>
                  </select>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px]" style={{ color: '#E9E9F0' }}>
                  <input type="checkbox" checked={musicOn} onChange={(e) => setMusicOn(e.target.checked)} />
                  Background music
                </label>
                {musicOn && (
                  <input type="text" value={musicText} onChange={(e) => setMusicText(e.target.value)} placeholder="e.g. upbeat lo-fi (leave blank for a default track)" maxLength={120} className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                )}
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel>B-roll URL</FieldLabel>
                <input type="text" value={brollUrl} onChange={(e) => setBrollUrl(e.target.value)} placeholder="https://…  — the person narrates over this footage" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
                <Callout>An https video URL the person talks over instead of appearing full-frame.</Callout>
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 self-start rounded-full px-5 py-2.5 text-sm font-semibold"
              style={{ backgroundColor: saving ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? 'Save changes' : 'Save prompt'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>

          {saveOk && !saveErr && (
            <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: '#34D399' }}>
              Saved. Head to the Agent page and use the &quot;+&quot; menu to run it.
            </span>
          )}
          {saveErr && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
              {saveErr}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function CharacterGrid({ selected, onSelect }: { selected: string | null; onSelect: (c: SavedCharacter) => void }) {
  const [items, setItems] = useState<SavedCharacter[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/dashboard/characters', { credentials: 'include' });
        const j = r.ok ? ((await r.json()) as { characters?: SavedCharacter[] }) : { characters: [] };
        if (!cancelled) setItems(j.characters ?? []);
      } catch { if (!cancelled) setItems([]); }
    })();
    return () => { cancelled = true; };
  }, []);
  if (items === null) return <div className="flex h-16 items-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  if (items.length === 0) return <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>No saved characters yet — create one on the Actors page, or use Describe / Upload instead.</p>;
  return (
    <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c)}
          className="flex flex-col gap-1 rounded-lg p-1 text-left"
          style={{ border: `1px solid ${selected === c.id ? '#A78BFA' : 'rgba(255,255,255,0.06)'}`, backgroundColor: '#0F1015' }}
        >
          <div className="relative aspect-square w-full overflow-hidden rounded-md" style={{ backgroundColor: '#191A22' }}>
            {(c.thumbnail_url ?? c.character_sheet_url) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumbnail_url ?? c.character_sheet_url ?? ''} alt={c.name ?? ''} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full items-center justify-center"><Users className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.25)' }} /></div>
            )}
          </div>
          <span className="truncate text-[10px]" style={{ color: '#E9E9F0' }}>{c.name ?? 'Unnamed'}</span>
        </button>
      ))}
    </div>
  );
}

function ActorGrid({ selected, onSelect }: { selected: string | null; onSelect: (a: StockActor) => void }) {
  const [items, setItems] = useState<StockActor[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/actors', { credentials: 'include' });
        const j = r.ok ? ((await r.json()) as { actors?: StockActor[] }) : { actors: [] };
        if (!cancelled) setItems(j.actors ?? []);
      } catch { if (!cancelled) setItems([]); }
    })();
    return () => { cancelled = true; };
  }, []);
  if (items === null) return <div className="flex h-16 items-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  return (
    <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
      {items.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onSelect(a)}
          className="flex flex-col gap-1 rounded-lg p-1 text-left"
          style={{ border: `1px solid ${selected === a.id ? '#A78BFA' : 'rgba(255,255,255,0.06)'}`, backgroundColor: '#0F1015' }}
        >
          <div className="relative aspect-square w-full overflow-hidden rounded-md" style={{ backgroundColor: '#191A22' }}>
            {a.portrait_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.portrait_url} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full items-center justify-center"><Users className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.25)' }} /></div>
            )}
          </div>
          <span className="truncate text-[10px]" style={{ color: '#E9E9F0' }}>{a.name}</span>
        </button>
      ))}
    </div>
  );
}

function PhotoUpload({ dataUrl, onChange }: { dataUrl: string; onChange: (v: string) => void }) {
  const onFile = (file: File | null) => {
    if (!file) { onChange(''); return; }
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
      className="flex w-full max-w-xs cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-6 text-center"
      style={{ backgroundColor: '#0F1015', border: '1px dashed rgba(255,255,255,0.18)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}
    >
      <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {dataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt="preview" style={{ maxHeight: 96, borderRadius: 6 }} />
          <span style={{ color: '#34D399' }}>photo attached — click to replace</span>
        </>
      ) : (
        <>
          <UploadCloud className="h-5 w-5" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <span>drop a photo here, or click to choose</span>
        </>
      )}
    </label>
  );
}
