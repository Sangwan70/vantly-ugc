// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Shared skill-run form + active-run card, extracted from
 * /dashboard/skills/[slug]/page.tsx so the same submit/poll logic can be
 * reused by the agent page's "Run a skill" composer option (see
 * /dashboard/agent) without duplicating ~700 lines of field-rendering code.
 *
 * Exports the pieces a caller needs to embed a full skill-run form:
 *  - `SkillEntry` / `RunResult` — the shapes a caller threads through.
 *  - `RunPanel` — the form + active-run card. Pass `onLaunched` to learn the
 *    new run's id/composed-ness (e.g. to start polling, or to redirect).
 *
 * Field renderers (FieldRow, CharacterPickerField, CharacterListField,
 * CharacterRow, SceneListField) are internal — no caller has needed to
 * render a single field standalone, so they stay unexported until one does.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Sparkles, Volume2 } from 'lucide-react';
import type { Field } from './_forms';

interface CharacterItem { name: string; description: string; ref: string; ref_base64: string }
interface SceneItem { speaker: string; line: string; visual_description: string }

// make_storybook can attach up to 4 of these in ONE run request (one per
// cast member) with nothing upstream to shrink them until the request
// hits skills/[slug]/run/route.ts's own Content-Length guard. An
// unresized phone/camera photo runs 2-3MB+ each — times 4 that blows well
// past what a reverse proxy in front of this app will forward intact, and
// the request arrives at the server truncated, surfacing as a confusing
// "invalid_json" error instead of a clear size message. Downscaling to
// the longest edge below and re-encoding as JPEG keeps a solid recognizable
// reference photo while cutting a typical phone photo to a fraction of its
// original size, so this stays well under any body-size limit in practice.
const IMAGE_MAX_DIM = 1280;
const IMAGE_JPEG_QUALITY = 0.82;

function compressImageFile(file: File, maxDim = IMAGE_MAX_DIM, quality = IMAGE_JPEG_QUALITY): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { width, height } = img;
      if (!width || !height) { reject(new Error('Could not read image dimensions')); return; }
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const outW = Math.max(1, Math.round(width * scale));
      const outH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas is not supported in this browser')); return; }
      ctx.drawImage(img, 0, 0, outW, outH);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read that image file'));
    };
    img.src = objectUrl;
  });
}

export interface SkillEntry {
  slug: string;
  name: string;
  version: string;
  description: string;
  primitive: string;
}

export interface RunResult {
  composed: boolean;
  id: string;
  status: string;
  current_step?: string | null;
  steps?: Array<{ primitive: string; status: string; artifacts?: Array<{ url: string }> }>;
  artifacts?: Array<{ url: string }>;
  final_output?: Record<string, unknown> | null;
  error?: { code: string; message: string | null } | null;
}

// Tentative wall-clock estimate for make_ugc_video (character_sheet_gpt2 +
// simple_selfie on the standard seedance-2.0 tier -- the enforced default,
// see services/primitive-worker-vnext/src/config.ts). Extrapolated from the
// only real data point in the model catalog (packages/schema/src/v2/
// models.ts): seedance-2.0 renders "about 3 minutes for a 5s clip at
// 720p"; character-sheet generation (gpt-image-2.5-sunburst) adds roughly
// another 30-45s. This is a rough guide for setting expectations, not a
// guarantee -- queueing, retries, and provider variance can push it either
// way, hence the range rather than a single number.
function estimateMakeUgcVideoEta(durationSeconds: number): string {
  const perSecondOfVideo = 36; // seconds of render time per second of output video
  const sheetSeconds = 45;
  const midSeconds = sheetSeconds + durationSeconds * perSecondOfVideo;
  const lowMinutes = Math.max(2, Math.round((midSeconds * 0.75) / 60));
  const highMinutes = Math.max(lowMinutes + 1, Math.round((midSeconds * 1.4) / 60));
  return `about ${lowMinutes}\u2013${highMinutes} minutes`;
}

// Skills we don't have per-model timing data for yet fall back to this
// honest, non-specific guide rather than guessing a wrong number.
const GENERIC_ETA = 'a few minutes \u2014 sometimes longer for video';

export function estimateSkillEta(skillSlug: string, body: Record<string, unknown>): string {
  if (skillSlug === 'make_ugc_video' || skillSlug === 'make_ugc') {
    const raw = body.duration;
    const duration = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(duration) && duration > 0) return estimateMakeUgcVideoEta(duration);
  }
  return GENERIC_ETA;
}

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'error']);

function defaultForField(f: Field): unknown {
  if (f.kind === 'select') return f.defaultValue ?? f.options[0];
  if (f.kind === 'number-select') return f.defaultValue ?? f.options[0];
  if (f.kind === 'boolean' || f.kind === 'toggle') return f.defaultValue ?? false;
  if (f.kind === 'character-list' || f.kind === 'scene-list') return [];
  return '';
}

export function RunPanel({
  skill,
  form,
  activeRun,
  onLaunched,
  initialValues,
  submitLabel = 'Run skill',
  hideHeading,
}: {
  skill: SkillEntry;
  form?: { fields: Field[]; composed: boolean };
  activeRun: RunResult | null;
  onLaunched: (r: RunResult) => void;
  /** Extra values to seed into the submitted body even for fields NOT in
   *  `form.fields` (e.g. a caller-driven aspect_ratio picked outside this
   *  panel's own field list). Applied once, on mount. */
  initialValues?: Record<string, unknown>;
  /** Text on the submit button. Defaults to "Run skill" for the generic
   *  Skill Center use; a caller with its own framing (e.g. the agent
   *  page's video composer) can pass something that reads better there. */
  submitLabel?: string;
  /** Hide the "RUN" section label above the fields — for a caller (like
   *  the agent composer) that already has its own prominent title above
   *  this panel, so a second generic heading doesn't compete with it. */
  hideHeading?: boolean;
}) {
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (!form) return { ...o, ...initialValues };
    for (const f of form.fields) {
      o[f.name] = defaultForField(f);
      if (f.kind === 'toggle') for (const c of f.children ?? []) o[c.name] = defaultForField(c);
    }
    return { ...o, ...initialValues };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [launchEta, setLaunchEta] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitErr(null);
    setSubmitting(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      // UI-only helper fields (e.g. a toggle's synthetic "_enabled" flag
      // that has no matching backend prop) never leave the browser.
      if (k.startsWith('_')) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (k === 'characters' && Array.isArray(v)) {
        const cleaned = (v as CharacterItem[])
          .filter((c) => c.name?.trim())
          .map((c) => {
            const out: Record<string, unknown> = { name: c.name.trim() };
            if (c.description?.trim()) out.description = c.description.trim();
            if (c.ref_base64?.trim()) out.ref_base64 = c.ref_base64.trim();
            else if (c.ref?.trim()) out.ref = c.ref.trim();
            return out;
          });
        if (cleaned.length) body[k] = cleaned;
        continue;
      }
      if (k === 'scenes' && Array.isArray(v)) {
        const cleaned = (v as SceneItem[])
          .filter((s) => s.speaker?.trim() && s.line?.trim() && s.visual_description?.trim())
          .map((s) => ({ speaker: s.speaker.trim(), line: s.line.trim(), visual_description: s.visual_description.trim() }));
        if (cleaned.length) body[k] = cleaned;
        continue;
      }
      body[k] = v;
    }
    try {
      const resp = await fetch(`/api/v1/skills/${encodeURIComponent(skill.slug)}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        setSubmitErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        return;
      }
      const id = (data.skill_run_id ?? data.run_id) as string | undefined;
      if (!id) { setSubmitErr('no run id returned'); return; }
      setLaunchEta(estimateSkillEta(skill.slug, body));
      onLaunched({ composed: form.composed, id, status: 'submitted' });
    } catch (err) {
      setSubmitErr((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onChangeAny = (name: string, v: unknown) => setValues((p) => ({ ...p, [name]: v }));

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      {!hideHeading && <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Run</h2>}
      {form ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {form.fields.map((f) => (
            <FieldRow key={f.name} field={f} value={values[f.name]} allValues={values} onChange={(v) => onChangeAny(f.name, v)} onChangeAny={onChangeAny} />
          ))}
          {submitErr && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
              {submitErr}
            </div>
          )}
          <div className="flex items-center justify-end">
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors" style={{ backgroundColor: submitting ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {submitLabel}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          No form configured for this skill. Call <code>POST /v1/skills/{skill.slug}/run</code> directly.
        </p>
      )}

      {activeRun && launchEta && !TERMINAL_RUN_STATUSES.has(activeRun.status) && (
        <div className="mt-3 rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(52,211,153,0.25)', backgroundColor: 'rgba(52,211,153,0.06)', color: '#E9E9F0' }}>
          You&apos;re all set — this is submitted and rendering now. It usually takes{' '}
          <strong>{launchEta}</strong>. Feel free to do something else in the meantime — you can check on it anytime{' '}
          <Link href={`/dashboard/skills/runs/${encodeURIComponent(activeRun.id)}${activeRun.composed ? '?composed=1' : ''}`} className="underline" style={{ color: '#34D399' }}>
            here
          </Link>.
        </div>
      )}

      {activeRun && (
        <Link href={`/dashboard/skills/runs/${encodeURIComponent(activeRun.id)}${activeRun.composed ? '?composed=1' : ''}`} className="mt-3 flex flex-col gap-2 rounded-xl px-4 py-3 transition-colors hover:opacity-90" style={{ border: '1px solid rgba(167,139,250,0.25)', backgroundColor: 'rgba(167,139,250,0.06)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: '#A78BFA' }}>Active run</span>
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{activeRun.id}</span>
          </div>
          <span className="text-sm" style={{ color: '#E9E9F0' }}>{activeRun.status}{activeRun.current_step ? ` · ${activeRun.current_step}` : ''}</span>
          {(activeRun.steps ?? []).map((s, i) => (
            <div key={`${s.primitive}-${i}`} className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className="inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.status === 'succeeded' ? '#34D399' : s.status === 'failed' ? '#F87171' : '#A78BFA' }} />
              <span>{s.primitive}</span>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{s.status}</span>
            </div>
          ))}
          <span className="text-[11px] underline" style={{ color: '#A78BFA' }}>open full timeline →</span>
        </Link>
      )}
    </div>
  );
}

function FieldRow({ field, value, onChange, allValues, onChangeAny }: { field: Field; value: unknown; onChange: (v: unknown) => void; allValues?: Record<string, unknown>; onChangeAny?: (name: string, v: unknown) => void }) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const labelEl = (
    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}{('required' in field && field.required) ? ' *' : ''}</label>
  );
  if (field.kind === 'text') {
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        {field.textarea ? (
          <textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} style={inputStyle} />
        ) : (
          <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} style={inputStyle} />
        )}
        {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      </div>
    );
  }
  if (field.kind === 'select') {
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {field.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
        </select>
        {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      </div>
    );
  }
  if (field.kind === 'number-select') {
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        <select value={String(value ?? '')} onChange={(e) => onChange(Number(e.target.value))} style={inputStyle}>
          {field.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
        </select>
      </div>
    );
  }
  if (field.kind === 'character-picker') {
    return <CharacterPickerField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'script-ai') {
    return <ScriptAiField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'voice-picker') {
    return <VoicePickerField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'toggle') {
    return <ToggleField field={field} value={value} onChange={onChange} allValues={allValues} onChangeAny={onChangeAny} />;
  }
  if (field.kind === 'character-list') {
    return <CharacterListField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'scene-list') {
    const chars = allValues?.[field.charactersField];
    const characterNames = Array.isArray(chars)
      ? Array.from(new Set((chars as CharacterItem[]).map((c) => c.name?.trim()).filter((n): n is string => Boolean(n))))
      : [];
    return <SceneListField field={field} value={value} onChange={onChange} characterNames={characterNames} />;
  }
  if (field.kind === 'image') {
    const dataUrl = typeof value === 'string' ? value : '';
    const onFile = (file: File | null) => {
      if (!file) { onChange(''); return; }
      const reader = new FileReader();
      reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsDataURL(file);
    };
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-3 py-4 text-center"
          style={{ backgroundColor: '#0F1015', border: '1px dashed rgba(255,255,255,0.18)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}
        >
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {dataUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl} alt="product preview" style={{ maxHeight: 96, borderRadius: 6 }} />
              <span style={{ color: '#34D399' }}>image attached — click to replace</span>
            </>
          ) : (
            <span>drop an image here, or click to choose (PNG/JPEG)</span>
          )}
        </label>
        {dataUrl && (
          <button type="button" onClick={() => onChange('')} className="self-start text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>
            remove
          </button>
        )}
        {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      {field.label}
    </label>
  );
}

/**
 * An on/off switch that expands to reveal its `children` fields right
 * below it when on, and collapses (resetting each child to its own
 * default, so a stale value can never sneak into the submitted body)
 * when off. Used for settings that gate another field — e.g. Background
 * Music -> Music preference — instead of two same-looking rows that
 * don't visually communicate the dependency.
 */
function ToggleField({ field, value, onChange, allValues, onChangeAny }: {
  field: Extract<Field, { kind: 'toggle' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  allValues?: Record<string, unknown>;
  onChangeAny?: (name: string, v: unknown) => void;
}) {
  const enabled = Boolean(value);
  const children = field.children ?? [];

  function handleToggle(next: boolean) {
    onChange(next);
    if (!next) for (const c of children) onChangeAny?.(c.name, defaultForField(c));
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => handleToggle(!enabled)}
        className="flex items-center gap-2.5 self-start text-left"
      >
        <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors" style={{ backgroundColor: enabled ? '#A78BFA' : 'rgba(255,255,255,0.15)' }}>
          <span className="inline-block h-3.5 w-3.5 rounded-full transition-transform" style={{ backgroundColor: '#fff', transform: enabled ? 'translateX(18px)' : 'translateX(3px)' }} />
        </span>
        <span className="text-[13px] font-medium" style={{ color: '#E9E9F0' }}>{field.label}</span>
      </button>
      {field.help && <span className="pl-[46px] text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      {enabled && children.length > 0 && (
        <div className="ml-[19px] flex flex-col gap-3 border-l pl-4" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          {children.map((c) => (
            <FieldRow key={c.name} field={c} value={allValues?.[c.name]} allValues={allValues} onChange={(v) => onChangeAny?.(c.name, v)} onChangeAny={onChangeAny} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SavedCharacter {
  id: string;
  name: string | null;
  character_sheet_url: string | null;
  thumbnail_url: string | null;
}

interface StockActor {
  id: string;
  slug: string;
  name: string;
  portrait_url: string | null;
}

function CharacterPickerField({ field, value, onChange }: { field: Extract<Field, { kind: 'character-picker' }>; value: unknown; onChange: (v: unknown) => void }) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const [tab, setTab] = useState<'mine' | 'stock'>('mine');
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [actors, setActors] = useState<StockActor[] | null>(null);
  const [open, setOpen] = useState(false);
  const current = typeof value === 'string' ? value : '';

  useEffect(() => {
    if (!open) return;
    if (tab === 'mine' && characters === null) {
      fetch('/api/dashboard/characters', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { characters: [] }))
        .then((j) => setCharacters(j.characters ?? []))
        .catch(() => setCharacters([]));
    }
    if (tab === 'stock' && actors === null) {
      fetch('/api/actors', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { actors: [] }))
        .then((j) => setActors(j.actors ?? []))
        .catch(() => setActors([]));
    }
  }, [open, tab, characters, actors]);

  const selectedLabel = (() => {
    if (!current) return null;
    const c = characters?.find((c) => c.character_sheet_url === current);
    if (c) return c.name ?? 'Saved character';
    const a = actors?.find((a) => a.portrait_url === current);
    if (a) return a.name;
    return null;
  })();

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>

      {current && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
          {(current.startsWith('http') && (current.includes('r2.dev') || current.includes('supabase'))) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />
          )}
          <span className="flex-1 truncate text-[12px]" style={{ color: '#E9E9F0' }}>{selectedLabel ?? current}</span>
          <button type="button" onClick={() => onChange('')} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.5)' }}>clear</button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="self-start text-[12px] underline"
        style={{ color: '#A78BFA' }}
      >
        {open ? 'hide picker' : current ? 'change character' : 'choose a saved character or stock actor'}
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
          <div className="flex gap-1">
            <button type="button" onClick={() => setTab('mine')} className="rounded-full px-3 py-1 text-[11px]" style={{ backgroundColor: tab === 'mine' ? '#A78BFA' : 'rgba(255,255,255,0.06)', color: tab === 'mine' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}>My characters</button>
            <button type="button" onClick={() => setTab('stock')} className="rounded-full px-3 py-1 text-[11px]" style={{ backgroundColor: tab === 'stock' ? '#A78BFA' : 'rgba(255,255,255,0.06)', color: tab === 'stock' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}>Stock actors</button>
          </div>

          {tab === 'mine' && (
            characters === null ? (
              <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>loading…</div>
            ) : characters.length === 0 ? (
              <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                No saved characters yet — generate one, or use the photo upload above.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {characters.filter((c) => c.character_sheet_url).map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => { onChange(c.character_sheet_url); setOpen(false); }}
                    className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:opacity-80"
                    style={{ border: current === c.character_sheet_url ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.06)' }}
                    title={c.name ?? undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumbnail_url ?? c.character_sheet_url ?? ''} alt={c.name ?? 'character'} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6 }} />
                    <span className="w-full truncate text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{c.name ?? 'Unnamed'}</span>
                  </button>
                ))}
              </div>
            )
          )}

          {tab === 'stock' && (
            actors === null ? (
              <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>loading…</div>
            ) : actors.length === 0 ? (
              <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No stock actors available.</div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {actors.filter((a) => a.portrait_url).map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => { onChange(a.portrait_url); setOpen(false); }}
                    className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:opacity-80"
                    style={{ border: current === a.portrait_url ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.06)' }}
                    title={a.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.portrait_url ?? ''} alt={a.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6 }} />
                    <span className="w-full truncate text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{a.name}</span>
                  </button>
                ))}
              </div>
            )
          )}

          <input
            type="text"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            style={inputStyle}
          />
        </div>
      )}

      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}


/**
 * A script textarea with a hover-reveal "Generate with AI" sparkle at its
 * right edge (mouse-over the field, or focus it on touch). Treats whatever
 * is currently typed as a one-line pitch/idea, drafts a full spoken script
 * via POST /v1/assist/draft-script, and replaces the box's content with the
 * result -- still a plain editable textarea afterward, so the user can
 * paste their own script here just as easily as generating one.
 */
function ScriptAiField({ field, value, onChange }: { field: Extract<Field, { kind: 'script-ai' }>; value: unknown; onChange: (v: unknown) => void }) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 40px 8px 10px', fontSize: 13, width: '100%' };
  const [hover, setHover] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const text = String(value ?? '');

  const generate = async () => {
    if (!text.trim() || drafting) return;
    setDrafting(true);
    setDraftErr(null);
    try {
      const resp = await fetch('/api/v1/assist/draft-script', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitch: text.trim(), target_duration: 'auto' }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? `HTTP ${resp.status}`;
        setDraftErr(typeof msg === 'string' ? msg : 'Could not draft a script.');
        return;
      }
      const script = typeof data.script === 'string' ? data.script : null;
      if (script) onChange(script);
      else setDraftErr('The draft came back empty — try rephrasing your idea.');
    } catch (err) {
      setDraftErr((err as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>
      <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setHover(true)}
          placeholder={field.placeholder}
          style={inputStyle}
        />
        {(hover || drafting) && text.trim() && (
          <button
            type="button"
            onClick={generate}
            disabled={drafting}
            title="Generate with AI"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full transition-opacity disabled:opacity-60"
            style={{ backgroundColor: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)' }}
          >
            {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#A78BFA' }} /> : <Sparkles className="h-3.5 w-3.5" style={{ color: '#A78BFA' }} />}
          </button>
        )}
      </div>
      {draftErr && <span className="text-[11px]" style={{ color: '#F87171' }}>{draftErr}</span>}
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}

interface ElevenLabsVoiceOption {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category?: string;
}

/** Voice Actor picker: lists real ElevenLabs voices, with a play-preview per
 *  voice. Value is a bare voice_id, or '' for the default AI voice. Renders
 *  a plain "voiceover isn't set up" note (never an error) when the account
 *  has no ElevenLabs key configured, per GET /v1/voices/elevenlabs's
 *  `configured: false` response. */
function VoicePickerField({ field, value, onChange }: { field: Extract<Field, { kind: 'voice-picker' }>; value: unknown; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoiceOption[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const current = typeof value === 'string' ? value : '';

  useEffect(() => {
    if (!open || voices !== null) return;
    fetch('/api/v1/voices/elevenlabs', { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { configured?: boolean; voices?: ElevenLabsVoiceOption[] }) => {
        setConfigured(j.configured !== false);
        setVoices(j.voices ?? []);
      })
      .catch(() => { setVoices([]); setLoadErr('Could not load voices.'); });
  }, [open, voices]);

  const selected = voices?.find((v) => v.voice_id === current);

  const togglePreview = (v: ElevenLabsVoiceOption) => {
    if (!v.preview_url) return;
    if (playingId === v.voice_id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(v.preview_url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    void audio.play();
    setPlayingId(v.voice_id);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>

      {current && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
          <span className="flex-1 truncate text-[12px]" style={{ color: '#E9E9F0' }}>{selected?.name ?? current}</span>
          <button type="button" onClick={() => onChange('')} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.5)' }}>clear</button>
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} className="self-start text-[12px] underline" style={{ color: '#A78BFA' }}>
        {open ? 'hide voices' : current ? 'change voice' : 'choose a voice'}
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
          {!configured ? (
            <div className="py-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Voiceover isn&apos;t set up for this account yet — the default AI voice will be used.
            </div>
          ) : voices === null ? (
            <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>loading…</div>
          ) : voices.length === 0 ? (
            <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{loadErr ?? 'No voices available.'}</div>
          ) : (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {voices.map((v) => (
                <div key={v.voice_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ border: current === v.voice_id ? '1px solid #A78BFA' : '1px solid transparent', backgroundColor: current === v.voice_id ? 'rgba(167,139,250,0.08)' : 'transparent' }}>
                  {v.preview_url && (
                    <button type="button" onClick={() => togglePreview(v)} title="Preview" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                      <Volume2 className="h-3 w-3" style={{ color: playingId === v.voice_id ? '#A78BFA' : 'rgba(255,255,255,0.5)' }} />
                    </button>
                  )}
                  <button type="button" onClick={() => { onChange(v.voice_id); setOpen(false); }} className="flex-1 truncate text-left text-[12.5px]" style={{ color: '#E9E9F0' }}>
                    {v.name}{v.category ? <span style={{ color: 'rgba(255,255,255,0.4)' }}> · {v.category}</span> : null}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}

interface CharacterListValue extends CharacterItem {}

function CharacterListField({ field, value, onChange }: { field: Extract<Field, { kind: 'character-list' }>; value: unknown; onChange: (v: unknown) => void }) {
  const items = Array.isArray(value) ? (value as CharacterListValue[]) : [];
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [actors, setActors] = useState<StockActor[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const ensureLoaded = () => {
    if (loaded) return;
    setLoaded(true);
    fetch('/api/dashboard/characters', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((j) => setCharacters(j.characters ?? []))
      .catch(() => setCharacters([]));
    fetch('/api/actors', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { actors: [] }))
      .then((j) => setActors(j.actors ?? []))
      .catch(() => setActors([]));
  };

  const updateItem = (i: number, patch: Partial<CharacterListValue>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const addItem = () => {
    if (items.length >= field.max) return;
    onChange([...items, { name: '', description: '', ref: '', ref_base64: '' }]);
    ensureLoaded();
  };
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>
      {items.length === 0 && (
        <div className="rounded-lg px-3 py-3 text-center text-[12px]" style={{ border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.4)' }}>
          No characters yet — add at least one.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <CharacterRow key={i} index={i} item={item} characters={characters} actors={actors} onOpenPicker={ensureLoaded} onChange={(patch) => updateItem(i, patch)} onRemove={() => removeItem(i)} />
        ))}
      </div>
      {items.length < field.max && (
        <button type="button" onClick={addItem} className="self-start rounded-full px-3 py-1.5 text-[12px]" style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.3)' }}>
          + add character
        </button>
      )}
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}

function CharacterRow({
  index,
  item,
  characters,
  actors,
  onOpenPicker,
  onChange,
  onRemove,
}: {
  index: number;
  item: CharacterListValue;
  characters: SavedCharacter[] | null;
  actors: StockActor[] | null;
  onOpenPicker: () => void;
  onChange: (patch: Partial<CharacterListValue>) => void;
  onRemove: () => void;
}) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'mine' | 'stock'>('mine');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const onFile = (file: File | null) => {
    if (!file) { setPhotoError(null); onChange({ ref_base64: '' }); return; }
    setPhotoError(null);
    setCompressing(true);
    compressImageFile(file)
      .then((dataUrl) => onChange({ ref_base64: dataUrl, ref: '' }))
      .catch(() => setPhotoError('Could not read that image — try a different file.'))
      .finally(() => setCompressing(false));
  };

  const pickedThumb = item.ref && (item.ref.includes('r2.dev') || item.ref.includes('supabase')) ? item.ref : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>Character {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>remove</button>
      </div>

      <input type="text" value={item.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name — must match a scene speaker (e.g. Pip)" style={inputStyle} />

      <textarea rows={2} value={item.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Description — a curious fox cub in a blue scarf" style={inputStyle} />

      <div className="flex flex-col gap-1">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-3 py-3 text-center"
          style={{ backgroundColor: '#14151F', border: '1px dashed rgba(255,255,255,0.18)', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}
        >
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {compressing ? (
            <span>compressing photo…</span>
          ) : item.ref_base64 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.ref_base64} alt="character preview" style={{ maxHeight: 72, borderRadius: 6 }} />
              <span style={{ color: '#34D399' }}>photo attached — click to replace</span>
            </>
          ) : (
            <span>…or upload a photo</span>
          )}
        </label>
        {photoError && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{photoError}</span>}
        {item.ref_base64 && (
          <button type="button" onClick={() => onChange({ ref_base64: '' })} className="self-start text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>remove photo</button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {item.ref && !item.ref_base64 && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
            {pickedThumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pickedThumb} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
            )}
            <span className="flex-1 truncate text-[12px]" style={{ color: '#E9E9F0' }}>{item.ref}</span>
            <button type="button" onClick={() => onChange({ ref: '' })} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.5)' }}>clear</button>
          </div>
        )}
        <button
          type="button"
          onClick={() => { setPickerOpen((o) => !o); if (!pickerOpen) onOpenPicker(); }}
          className="self-start text-[12px] underline"
          style={{ color: '#A78BFA' }}
        >
          {pickerOpen ? 'hide picker' : item.ref && !item.ref_base64 ? 'change saved character' : '…or reuse a saved character'}
        </button>

        {pickerOpen && (
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#14151F' }}>
            <div className="flex gap-1">
              <button type="button" onClick={() => setPickerTab('mine')} className="rounded-full px-3 py-1 text-[11px]" style={{ backgroundColor: pickerTab === 'mine' ? '#A78BFA' : 'rgba(255,255,255,0.06)', color: pickerTab === 'mine' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}>My characters</button>
              <button type="button" onClick={() => setPickerTab('stock')} className="rounded-full px-3 py-1 text-[11px]" style={{ backgroundColor: pickerTab === 'stock' ? '#A78BFA' : 'rgba(255,255,255,0.06)', color: pickerTab === 'stock' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}>Stock actors</button>
            </div>
            {pickerTab === 'mine' && (
              characters === null ? (
                <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>loading…</div>
              ) : characters.length === 0 ? (
                <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No saved characters yet.</div>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {characters.filter((c) => c.character_sheet_url).map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => { onChange({ ref: c.character_sheet_url ?? '', ref_base64: '' }); setPickerOpen(false); }}
                      className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:opacity-80"
                      style={{ border: item.ref === c.character_sheet_url ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.06)' }}
                      title={c.name ?? undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.thumbnail_url ?? c.character_sheet_url ?? ''} alt={c.name ?? 'character'} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6 }} />
                      <span className="w-full truncate text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{c.name ?? 'Unnamed'}</span>
                    </button>
                  ))}
                </div>
              )
            )}
            {pickerTab === 'stock' && (
              actors === null ? (
                <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>loading…</div>
              ) : actors.length === 0 ? (
                <div className="py-3 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>No stock actors available.</div>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {actors.filter((a) => a.portrait_url).map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => { onChange({ ref: a.portrait_url ?? '', ref_base64: '' }); setPickerOpen(false); }}
                      className="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors hover:opacity-80"
                      style={{ border: item.ref === a.portrait_url ? '1px solid #A78BFA' : '1px solid rgba(255,255,255,0.06)' }}
                      title={a.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.portrait_url ?? ''} alt={a.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6 }} />
                      <span className="w-full truncate text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{a.name}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SceneListField({
  field,
  value,
  onChange,
  characterNames,
}: {
  field: Extract<Field, { kind: 'scene-list' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  characterNames: string[];
}) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const items = Array.isArray(value) ? (value as SceneItem[]) : [];

  const updateItem = (i: number, patch: Partial<SceneItem>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const addItem = () => {
    if (items.length >= field.max) return;
    onChange([...items, { speaker: characterNames[0] ?? '', line: '', visual_description: '' }]);
  };
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>
      {items.length === 0 && (
        <div className="rounded-lg px-3 py-3 text-center text-[12px]" style={{ border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.4)' }}>
          No scenes yet — add at least one.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>Scene {i + 1}</span>
              <button type="button" onClick={() => removeItem(i)} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>remove</button>
            </div>
            {characterNames.length > 0 ? (
              <select value={item.speaker} onChange={(e) => updateItem(i, { speaker: e.target.value })} style={inputStyle}>
                <option value="" disabled>choose a speaker</option>
                {characterNames.map((n) => (<option key={n} value={n}>{n}</option>))}
              </select>
            ) : (
              <input type="text" value={item.speaker} onChange={(e) => updateItem(i, { speaker: e.target.value })} placeholder="add a character name above first" style={inputStyle} />
            )}
            <textarea rows={2} value={item.line} onChange={(e) => updateItem(i, { line: e.target.value })} placeholder="Line — what they say (5+ words)" style={inputStyle} />
            <textarea rows={2} value={item.visual_description} onChange={(e) => updateItem(i, { visual_description: e.target.value })} placeholder="Visual description — standing in a sunny meadow, looking curious" style={inputStyle} />
          </div>
        ))}
      </div>
      {items.length < field.max && (
        <button type="button" onClick={addItem} className="self-start rounded-full px-3 py-1.5 text-[12px]" style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.3)' }}>
          + add scene
        </button>
      )}
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}
