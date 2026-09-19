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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Loader2, Play, Plus, Sparkles, UploadCloud, Volume2, Wand2, Wrench, X } from 'lucide-react';
import type { Field, SkillForm } from './_forms';

interface CharacterItem { name: string; description: string; ref: string; ref_base64: string }
interface SceneItem { speaker: string; line: string; visual_description: string }
interface TurnItem { speaker: 'A' | 'B'; line: string }

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

// A skill-run 400 body looks like
// {"error":"invalid_input","skill":"make_ugc","detail":{"fieldErrors":{"person":["pass at most one of person, image, or character"]},"formErrors":[]}}
// -- the raw `error` code alone ("invalid_input") tells the user nothing
// actionable, so pull the real per-field reason out of `detail` when it's
// there (same shape the agent chat's own error recovery already parses).
function describeRunError(data: unknown, status: number): string {
  const d = data as { error?: unknown; detail?: unknown } | null;
  const detail = d?.detail as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
  if (detail && (detail.fieldErrors || detail.formErrors)) {
    const messages = [...Object.values(detail.fieldErrors ?? {}).flat(), ...(detail.formErrors ?? [])].filter(Boolean);
    if (messages.length > 0) return messages.join('; ');
  }
  if (typeof d?.error === 'string') return d.error;
  const errObj = d?.error as { message?: string } | undefined;
  if (errObj && typeof errObj.message === 'string') return errObj.message;
  return `HTTP ${status}`;
}

/**
 * Drafts a quick 1:1 portrait from a plain text description via the
 * standalone make_portrait skill, waits for it to finish, and returns the
 * resulting R2-hosted image URL — the "Generate Required Character
 * Images" step for a character-source field whose real skill (make_podcast)
 * only ever accepts a saved character or an image URL, never bare text.
 * Polls /v1/primitives/runs/:id every 4s, same cadence and endpoint the
 * run-timeline page (../skills/runs/[id]/page.tsx) already uses.
 */
async function generatePortraitFromDescription(description: string): Promise<string> {
  const startResp = await fetch('/api/v1/skills/make_portrait/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, aspect_ratio: '1:1' }),
  });
  const startData = (await startResp.json()) as Record<string, unknown>;
  if (!startResp.ok) throw new Error(describeRunError(startData, startResp.status));
  const runId = (startData.run_id ?? startData.skill_run_id) as string | undefined;
  if (!runId) throw new Error('character image generation did not return a run id');

  const deadline = Date.now() + 150_000; // portraits typically finish in well under a minute
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const pollResp = await fetch(`/api/v1/primitives/runs/${encodeURIComponent(runId)}`, { credentials: 'include' });
    if (!pollResp.ok) continue; // transient — keep polling until the deadline
    const pollData = (await pollResp.json()) as { status?: string; artifacts?: Array<{ url: string }>; error?: { message: string | null } | null };
    const status = pollData.status ?? '';
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const url = pollData.artifacts?.[0]?.url;
      if (!url) throw new Error('character image finished but returned no image');
      return url;
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelled' || status === 'error') {
      throw new Error(pollData.error?.message || 'character image generation failed');
    }
  }
  throw new Error('character image generation is taking longer than expected \u2014 try again in a moment, or switch to Upload Your Own / Select Existing Characters instead');
}

function defaultForField(f: Field): unknown {
  if (f.kind === 'select') return f.defaultValue ?? f.options[0];
  if (f.kind === 'number-select') return f.defaultValue ?? f.options[0];
  if (f.kind === 'boolean' || f.kind === 'toggle') return f.defaultValue ?? false;
  if (f.kind === 'character-list' || f.kind === 'scene-list' || f.kind === 'turn-list') return [];
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
  onUseSavedPrompt,
  onBrowseExamples,
  onRunDifferentSkill,
  prefillValues,
  onPrefillApplied,
}: {
  skill: SkillEntry;
  form?: SkillForm;
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
  /** Wired into the script-ai field's "+" menu, alongside its built-in
   *  photo upload — omit any of these to just not show that menu item. */
  onUseSavedPrompt?: () => void;
  onBrowseExamples?: () => void;
  onRunDifferentSkill?: () => void;
  /** A saved prompt / library example picked from the "+" menu (or a
   *  /dashboard/agent?example=<id> deep link) lands here when THIS screen
   *  has no chat yet — the freeform chat textarea those otherwise write
   *  into isn't even rendered in that case, so this form needs its own way
   *  in. Applied once via onChangeAny, then the caller is told to clear it
   *  (onPrefillApplied) so it doesn't stomp on further edits the user
   *  makes to the same field. */
  prefillValues?: Record<string, string> | null;
  onPrefillApplied?: () => void;
}) {
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (!form) return { ...o, ...initialValues };
    for (const f of form.fields) {
      o[f.name] = defaultForField(f);
      if (f.kind === 'toggle') for (const c of f.children ?? []) o[c.name] = defaultForField(c);
      if (f.kind === 'expandable') o[f.child.name] = defaultForField(f.child);
    }
    return { ...o, ...initialValues };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [launchEta, setLaunchEta] = useState<string | null>(null);
  // Only non-null while a character-source field's "Generate Required
  // Character Images" pre-step (see generatePortraitFromDescription) is
  // running, so the button can say something truer than a bare spinner —
  // this can take 30-60s BEFORE the main skill even starts.
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null);

  // "Cancel" (next to the submit button) resets every field back to this
  // screen's starting point in one click. Comparing live `values` against
  // `initial` (stable for the lifetime of this form — see its own useMemo
  // above) is what decides whether there's anything TO cancel: the button
  // stays disabled until the user has actually typed or picked something.
  const isDirty = JSON.stringify(values) !== JSON.stringify(initial);
  const onCancel = () => {
    setValues(initial);
    setSubmitErr(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitErr(null);
    // Safety net: the button is already disabled while this is non-null
    // (see liveValidationMsg below), but re-check here too in case values
    // changed between render and click.
    const preflightMsg = form.validate?.(values);
    if (preflightMsg) { setSubmitErr(preflightMsg); return; }
    setSubmitting(true);
    try {
      // Resolve any character-source field whose "Generate Required
      // Character Images" mode was picked but whose real backend field
      // (make_podcast's character_a/character_b) never accepts a bare
      // description — draft a quick portrait from the typed description
      // FIRST, then use its resulting image as if the user had picked an
      // existing character. Fields that accept a description directly
      // (make_ugc's `person`) have no generateViaPortrait and pass straight
      // through untouched.
      const resolved: Record<string, unknown> = { ...values };
      for (const f of form.fields) {
        if (f.kind !== 'character-source' || !f.generateViaPortrait) continue;
        const description = String(resolved[f.generateField] ?? '').trim();
        const alreadyHasIdentity =
          String(resolved[f.existingField] ?? '').trim() || String(resolved[f.uploadField] ?? '').trim();
        if (!description || alreadyHasIdentity) continue;
        setGeneratingLabel(`Generating ${f.label}…`);
        const url = await generatePortraitFromDescription(description);
        resolved[f.existingField] = url;
      }
      setGeneratingLabel(null);

      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(resolved)) {
        // UI-only helper fields (e.g. a toggle's synthetic "_enabled" flag,
        // or a character-source's "generate from this description" text
        // once it's been resolved to an image above) never leave the browser.
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
        // make_podcast's `script` is an array of A/B turns -- make_ugc's own
        // `script` is always a plain string, so the Array.isArray check is
        // what tells the two apart (there's no other skill with a `script`
        // array today).
        if (k === 'script' && Array.isArray(v)) {
          const cleaned = (v as TurnItem[])
            .filter((t) => (t.speaker === 'A' || t.speaker === 'B') && t.line?.trim())
            .map((t) => ({ speaker: t.speaker, line: t.line.trim() }));
          if (cleaned.length) body[k] = cleaned;
          continue;
        }
        body[k] = v;
      }
      const resp = await fetch(`/api/v1/skills/${encodeURIComponent(skill.slug)}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        setSubmitErr(describeRunError(data, resp.status));
        return;
      }
      const id = (data.skill_run_id ?? data.run_id) as string | undefined;
      if (!id) { setSubmitErr('no run id returned'); return; }
      setLaunchEta(estimateSkillEta(skill.slug, body));
      onLaunched({ composed: form.composed, id, status: 'submitted' });
    } catch (err) {
      setSubmitErr((err as Error).message);
    } finally {
      setGeneratingLabel(null);
      setSubmitting(false);
    }
  };

  const onChangeAny = (name: string, v: unknown) => {
    setValues((p) => {
      const next: Record<string, unknown> = { ...p, [name]: v };
      // Enforce form.exclusiveGroups: the instant one field in a group
      // gets a real value, clear its groupmates so a conflicting
      // combination (e.g. a typed Person description AND an attached
      // photo) can never reach submit -- the backend 400s on that, and
      // silently clearing here is friendlier than a post-submit error.
      const isNonEmpty = typeof v === 'string' ? v.trim() !== '' : Boolean(v);
      if (isNonEmpty) {
        for (const group of form?.exclusiveGroups ?? []) {
          if (!group.includes(name)) continue;
          for (const other of group) if (other !== name) next[other] = '';
        }
      }
      return next;
    });
  };

  // Apply a prefill (see the `prefillValues` prop doc above) the instant one
  // arrives, then tell the caller it's been consumed. Runs whenever the
  // OBJECT reference changes -- the caller passes a fresh object per
  // example/prompt picked, and null/undefined the rest of the time, so this
  // never re-fires for the same pick and never fights the user's own edits.
  useEffect(() => {
    if (!prefillValues) return;
    for (const [name, value] of Object.entries(prefillValues)) onChangeAny(name, value);
    onPrefillApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillValues]);

  // Toggle/expandable fields ("Background Music", "Language", …) render as
  // a wrapping row of pills rather than stacked full-width rows — tap one
  // to reveal just that setting instead of always showing every field at
  // once. Everything else (script, identity, plain selects) keeps the
  // normal stacked layout.
  const pillFields = form?.fields.filter((f) => f.kind === 'toggle' || f.kind === 'expandable') ?? [];
  const stackedFields = form?.fields.filter((f) => f.kind !== 'toggle' && f.kind !== 'expandable') ?? [];
  // Recomputed every render (cheap, plain string checks) so the Generate
  // button disables itself the instant an unmet requirement appears,
  // rather than only after a failed submit. See SkillForm.validate.
  const liveValidationMsg = form?.validate ? form.validate(values) : null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      {!hideHeading && <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Run</h2>}
      {form ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {stackedFields.map((f) => (
            <FieldRow key={f.name} field={f} value={values[f.name]} allValues={values} onChange={(v) => onChangeAny(f.name, v)} onChangeAny={onChangeAny} onUseSavedPrompt={onUseSavedPrompt} onBrowseExamples={onBrowseExamples} onRunDifferentSkill={onRunDifferentSkill} />
          ))}
          {pillFields.length > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              {pillFields.map((f) => (
                <FieldRow key={f.name} field={f} value={values[f.name]} allValues={values} onChange={(v) => onChangeAny(f.name, v)} onChangeAny={onChangeAny} />
              ))}
            </div>
          )}
          {!submitErr && liveValidationMsg && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.08)', color: '#FCD34D' }}>
              {liveValidationMsg}
            </div>
          )}
          {submitErr && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
              {submitErr}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {generatingLabel && (
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{generatingLabel}</span>
            )}
            {/* Only clickable once the user has actually typed or picked
                something — see isDirty's own doc comment above — so it
                reads as "start over" rather than a confusing no-op. */}
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting || !isDirty}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'transparent', color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.18)' }}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button type="submit" disabled={submitting || Boolean(liveValidationMsg)} title={liveValidationMsg ?? undefined} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50" style={{ backgroundColor: submitting || liveValidationMsg ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}>
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

function FieldRow({ field, value, onChange, allValues, onChangeAny, onUseSavedPrompt, onBrowseExamples, onRunDifferentSkill }: {
  field: Field; value: unknown; onChange: (v: unknown) => void; allValues?: Record<string, unknown>; onChangeAny?: (name: string, v: unknown) => void;
  onUseSavedPrompt?: () => void; onBrowseExamples?: () => void; onRunDifferentSkill?: () => void;
}) {
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
    return <ScriptAiField field={field} value={value} onChange={onChange} allValues={allValues} onChangeAny={onChangeAny} onUseSavedPrompt={onUseSavedPrompt} onBrowseExamples={onBrowseExamples} onRunDifferentSkill={onRunDifferentSkill} />;
  }
  if (field.kind === 'voice-picker') {
    return <VoicePickerField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'toggle') {
    return <ToggleField field={field} value={value} onChange={onChange} allValues={allValues} onChangeAny={onChangeAny} />;
  }
  if (field.kind === 'expandable') {
    return <ExpandableField field={field} allValues={allValues} onChangeAny={onChangeAny} />;
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
  if (field.kind === 'turn-list') {
    return <TurnListField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'character-source') {
    return <CharacterSourceField field={field} allValues={allValues} onChangeAny={onChangeAny} />;
  }
  if (field.kind === 'ai-draft-panel') {
    return <AiDraftPanelField field={field} allValues={allValues} onChangeAny={onChangeAny} />;
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
// Shared "pill that expands" chrome for both ToggleField and
// ExpandableField below. `active` drives the filled/outlined look;
// `open` (usually the same as `active` for a real toggle, or its own
// local state for a plain reveal) drives whether the +  flips to a  -
// and whether `panel` renders. The panel is full-width (`w-full`) so in
// a flex-wrap row it drops to its own line under the pill instead of
// squeezing beside it.
function PillField({ label, active, open, onClick, panel }: { label: string; active: boolean; open: boolean; onClick: () => void; panel?: ReactNode }) {
  return (
    <>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors"
        style={{
          backgroundColor: active ? 'rgba(167,139,250,0.16)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${active ? '#A78BFA' : 'rgba(255,255,255,0.14)'}`,
          color: active ? '#A78BFA' : 'rgba(255,255,255,0.75)',
        }}
      >
        {label}
        <span style={{ fontSize: 15, lineHeight: 1 }}>{open ? '−' : '+'}</span>
      </button>
      {open && panel && (
        <div className="w-full rounded-xl p-3" style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.08)' }}>
          {panel}
        </div>
      )}
    </>
  );
}

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

  const panel = (field.help || children.length > 0) ? (
    <div className="flex flex-col gap-3">
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      {children.map((c) => (
        <FieldRow key={c.name} field={c} value={allValues?.[c.name]} allValues={allValues} onChange={(v) => onChangeAny?.(c.name, v)} onChangeAny={onChangeAny} />
      ))}
    </div>
  ) : undefined;

  return <PillField label={field.label} active={enabled} open={enabled} onClick={() => handleToggle(!enabled)} panel={panel} />;
}

// A pill that just reveals its one wrapped field on click — no boolean of
// its own is submitted (see the `expandable` Field doc comment in
// _forms.ts). Closing it only hides the field, it doesn't clear what's in
// it. Auto-opens the moment its child field goes from empty to non-empty
// (see the effect below) -- needed once character-list/scene-list started
// wrapping in here (make_storybook's Characters/Scenes), since those get
// filled by the "Story" AI-draft panel above them: without this, a
// generated cast/scene list would land in a still-collapsed pill and the
// user would have no idea anything happened. A manual collapse afterward
// (the user reviewed it and wants it out of the way) sticks -- the effect
// only fires on the false -> true transition, not on every render.
function ExpandableField({ field, allValues, onChangeAny }: {
  field: Extract<Field, { kind: 'expandable' }>;
  allValues?: Record<string, unknown>;
  onChangeAny?: (name: string, v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const c = field.child;
  const v = allValues?.[c.name];
  const filled = Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : Boolean(v);

  useEffect(() => {
    if (filled) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled]);

  const panel = (
    <FieldRow field={c} value={v} allValues={allValues} onChange={(nv) => onChangeAny?.(c.name, nv)} onChangeAny={onChangeAny} />
  );

  return <PillField label={field.label} active={open || filled} open={open} onClick={() => setOpen((o) => !o)} panel={panel} />;
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
      {field.label && <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>}

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
 * ONE required character identity, presented as three explicit radio
 * choices rather than several always-visible fields fighting for
 * attention (see the `character-source` Field kind doc in ./_forms.ts for
 * the full rationale). Local `mode` state decides which single panel
 * shows; picking a mode clears the other two underlying fields so only
 * one identity source is ever in `values` at a time -- the same rule
 * `exclusiveGroups` enforces for make_ugc's person/image/character today,
 * just made visible as a choice instead of an implicit "last one wins".
 */
function CharacterSourceField({ field, allValues, onChangeAny }: {
  field: Extract<Field, { kind: 'character-source' }>;
  allValues?: Record<string, unknown>;
  onChangeAny?: (name: string, v: unknown) => void;
}) {
  type Mode = 'generate' | 'upload' | 'existing';
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const generateVal = String(allValues?.[field.generateField] ?? '');
  const uploadVal = String(allValues?.[field.uploadField] ?? '');
  const existingVal = String(allValues?.[field.existingField] ?? '');
  // Derived once from whatever the caller seeded in (a prefill, a saved
  // prompt) so re-opening a form with an existing pick doesn't silently
  // reset to "Generate" -- after that it's plain UI state the radios drive.
  const [mode, setMode] = useState<Mode>(() => (existingVal ? 'existing' : uploadVal ? 'upload' : 'generate'));
  const [compressing, setCompressing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const selectMode = (next: Mode) => {
    setMode(next);
    if (next !== 'generate') onChangeAny?.(field.generateField, '');
    if (next !== 'upload') onChangeAny?.(field.uploadField, '');
    if (next !== 'existing') onChangeAny?.(field.existingField, '');
  };

  const onFile = (file: File | null) => {
    if (!file) { onChangeAny?.(field.uploadField, ''); return; }
    setPhotoError(null);
    setCompressing(true);
    compressImageFile(file)
      .then((dataUrl) => onChangeAny?.(field.uploadField, dataUrl))
      .catch(() => setPhotoError('Could not read that image \u2014 try a different file.'))
      .finally(() => setCompressing(false));
  };

  const radioLabelStyle: React.CSSProperties = { color: '#E9E9F0' };

  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={radioLabelStyle}>
        <input type="radio" name={`${field.name}-mode`} checked={mode === 'generate'} onChange={() => selectMode('generate')} />
        Generate Required Character Images
      </label>
      {mode === 'generate' && (
        <textarea
          rows={2}
          value={generateVal}
          onChange={(e) => onChangeAny?.(field.generateField, e.target.value)}
          placeholder={field.generatePlaceholder ?? 'Describe the character in words \u2014 a friendly young woman, soft daylight'}
          style={{ ...inputStyle, marginLeft: 24, width: 'auto' }}
        />
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={radioLabelStyle}>
        <input type="radio" name={`${field.name}-mode`} checked={mode === 'upload'} onChange={() => selectMode('upload')} />
        Upload Your Own
      </label>
      {mode === 'upload' && (
        <div className="flex flex-col gap-1" style={{ marginLeft: 24 }}>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-3 py-4 text-center"
            style={{ backgroundColor: '#14151F', border: '1px dashed rgba(255,255,255,0.18)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}
          >
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            {compressing ? (
              <span>compressing photo\u2026</span>
            ) : uploadVal ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={uploadVal} alt="character preview" style={{ maxHeight: 96, borderRadius: 6 }} />
                <span style={{ color: '#34D399' }}>photo attached \u2014 click to replace</span>
              </>
            ) : (
              <span>drop a photo here, or click to choose (PNG/JPEG)</span>
            )}
          </label>
          {photoError && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{photoError}</span>}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={radioLabelStyle}>
        <input type="radio" name={`${field.name}-mode`} checked={mode === 'existing'} onChange={() => selectMode('existing')} />
        Select Existing Characters
      </label>
      {mode === 'existing' && (
        <div style={{ marginLeft: 24 }}>
          <CharacterPickerField
            field={{ kind: 'character-picker', name: field.existingField, label: '', placeholder: 'char_\u2026 or a character_sheet_url' }}
            value={existingVal}
            onChange={(v) => onChangeAny?.(field.existingField, v)}
          />
        </div>
      )}

      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}

/**
 * The main script textarea. Two corner buttons live INSIDE the box itself
 * rather than as separate rows above/below it, so this one control covers
 * everything the reference layout asked for:
 *  - bottom-left "+": a menu for attaching a photo of the person (reads
 *    straight to a base64 data URL into the sibling field named by
 *    `field.photoFieldName`, same as the old always-visible `image` drop
 *    zone used to), plus, when the caller wired them up, jumping to "use a
 *    saved prompt" / "run a different skill" — the same three things the
 *    classic chat composer's own "+" offered, now reachable without
 *    leaving this guided form.
 *  - bottom-right sparkle: "Generate with AI" — treats whatever's typed as
 *    a one-line pitch, drafts a full spoken script via
 *    POST /v1/assist/draft-script, and replaces the box's content with the
 *    result (still a plain editable textarea afterward).
 */
function ScriptAiField({ field, value, onChange, allValues, onChangeAny, onUseSavedPrompt, onBrowseExamples, onRunDifferentSkill }: {
  field: Extract<Field, { kind: 'script-ai' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  allValues?: Record<string, unknown>;
  onChangeAny?: (name: string, v: unknown) => void;
  onUseSavedPrompt?: () => void;
  onBrowseExamples?: () => void;
  onRunDifferentSkill?: () => void;
}) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 44px 40px 10px', fontSize: 13, width: '100%' };
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const text = String(value ?? '');
  const photoValue = field.photoFieldName ? String(allValues?.[field.photoFieldName] ?? '') : '';

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

  const onPickPhoto = (file: File | null) => {
    if (!file || !field.photoFieldName) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChangeAny?.(field.photoFieldName as string, reader.result);
    };
    reader.readAsDataURL(file);
  };

  const hasMenu = Boolean(field.photoFieldName || onUseSavedPrompt || onBrowseExamples || onRunDifferentSkill);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>
      {photoValue && (
        <div className="inline-flex w-fit items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-[12px]" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoValue} alt="attached person photo" className="h-6 w-6 rounded object-cover" />
          <span>Photo attached — face is locked to it</span>
          <button type="button" aria-label="Remove photo" onClick={() => onChangeAny?.(field.photoFieldName as string, '')} className="opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="relative">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          style={inputStyle}
        />
        {hasMenu && (
          <div className="absolute bottom-2 left-2">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { onPickPhoto(e.target.files?.[0] ?? null); setMenuOpen(false); }} />
            <button
              type="button"
              aria-label="Add"
              title="Add"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full"
              style={{ backgroundColor: '#1B1C2A', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.6)' }}
            >
              <Plus className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div onMouseLeave={() => setMenuOpen(false)} className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl p-1.5" style={{ background: '#1B1C2A', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                {field.photoFieldName && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06]" style={{ color: '#E9E9F0' }}>
                    <UploadCloud className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} /> …or upload a photo of the person
                  </button>
                )}
                {onUseSavedPrompt && (
                  <button type="button" onClick={() => { setMenuOpen(false); onUseSavedPrompt(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06]" style={{ color: '#E9E9F0' }}>
                    <Wand2 className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} /> Use a saved prompt
                  </button>
                )}
                {onBrowseExamples && (
                  <button type="button" onClick={() => { setMenuOpen(false); onBrowseExamples(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06]" style={{ color: '#E9E9F0' }}>
                    <BookOpen className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} /> Browse examples
                  </button>
                )}
                {onRunDifferentSkill && (
                  <button type="button" onClick={() => { setMenuOpen(false); onRunDifferentSkill(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06]" style={{ color: '#E9E9F0' }}>
                    <Wrench className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.5)' }} /> Run a different skill
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={generate}
          disabled={drafting || !text.trim()}
          title="Generate with AI"
          className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
          style={{ backgroundColor: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)' }}
        >
          {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#A78BFA' }} /> : <Sparkles className="h-3.5 w-3.5" style={{ color: '#A78BFA' }} />}
        </button>
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
  const [pickerTab, setPickerTab] = useState<'mine' | 'stock'>('mine');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  // Which of the three identity sources this character uses -- an explicit
  // choice instead of showing description + upload + picker all at once
  // (see the character-source Field kind's doc comment in ./_forms.ts for
  // the same pattern used by make_ugc / make_podcast). Derived once from
  // whatever's already on the item (a prefill, an edit reopened) so it
  // doesn't reset a real pick back to "Generate" on every render.
  const [mode, setMode] = useState<'generate' | 'upload' | 'existing'>(() =>
    item.ref ? 'existing' : item.ref_base64 ? 'upload' : 'generate',
  );

  const selectMode = (next: 'generate' | 'upload' | 'existing') => {
    setMode(next);
    if (next !== 'generate') onChange({ description: '' });
    if (next !== 'upload') onChange({ ref_base64: '' });
    if (next !== 'existing') onChange({ ref: '' });
  };

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

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: '#E9E9F0' }}>
        <input type="radio" name={`char-${index}-mode`} checked={mode === 'generate'} onChange={() => selectMode('generate')} />
        Generate Required Character Images
      </label>
      {mode === 'generate' && (
        <textarea rows={2} value={item.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Description — a curious fox cub in a blue scarf" style={{ ...inputStyle, marginLeft: 24, width: 'auto' }} />
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: '#E9E9F0' }}>
        <input type="radio" name={`char-${index}-mode`} checked={mode === 'upload'} onChange={() => selectMode('upload')} />
        Upload Your Own
      </label>
      {mode === 'upload' && (
      <div className="flex flex-col gap-1" style={{ marginLeft: 24 }}>
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
            <span>drop a photo here, or click to choose (PNG/JPEG)</span>
          )}
        </label>
        {photoError && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{photoError}</span>}
      </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12.5px]" style={{ color: '#E9E9F0' }}>
        <input type="radio" name={`char-${index}-mode`} checked={mode === 'existing'} onChange={() => { selectMode('existing'); onOpenPicker(); }} />
        Select Existing Characters
      </label>
      {mode === 'existing' && (
      <div className="flex flex-col gap-1" style={{ marginLeft: 24 }}>
        {item.ref && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
            {pickedThumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pickedThumb} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
            )}
            <span className="flex-1 truncate text-[12px]" style={{ color: '#E9E9F0' }}>{item.ref}</span>
            <button type="button" onClick={() => onChange({ ref: '' })} className="text-[11px] underline" style={{ color: 'rgba(255,255,255,0.5)' }}>clear</button>
          </div>
        )}

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
                      onClick={() => onChange({ ref: c.character_sheet_url ?? '', ref_base64: '' })}
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
                      onClick={() => onChange({ ref: a.portrait_url ?? '', ref_base64: '' })}
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
        </div>
      )}
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

function TurnListField({ field, value, onChange }: {
  field: Extract<Field, { kind: 'turn-list' }>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const items = Array.isArray(value) ? (value as TurnItem[]) : [];

  const updateItem = (i: number, patch: Partial<TurnItem>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const addItem = () => {
    if (items.length >= field.max) return;
    const lastSpeaker = items[items.length - 1]?.speaker;
    onChange([...items, { speaker: lastSpeaker === 'A' ? 'B' : 'A', line: '' }]);
  };
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{field.label}</label>
      {items.length === 0 && (
        <div className="rounded-lg px-3 py-3 text-center text-[12px]" style={{ border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.4)' }}>
          No lines yet — add at least one turn.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}>
            <select value={item.speaker} onChange={(e) => updateItem(i, { speaker: e.target.value as 'A' | 'B' })} style={{ ...inputStyle, width: 72, flexShrink: 0 }}>
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
            <textarea rows={2} value={item.line} onChange={(e) => updateItem(i, { line: e.target.value })} placeholder="What they say (5+ words)" style={{ ...inputStyle, flex: 1 }} />
            <button type="button" onClick={() => removeItem(i)} className="shrink-0 text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>remove</button>
          </div>
        ))}
      </div>
      {items.length < field.max && (
        <button type="button" onClick={addItem} className="self-start rounded-full px-3 py-1.5 text-[12px]" style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.3)' }}>
          + add turn
        </button>
      )}
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
    </div>
  );
}

/**
 * "Bare minimum: type a prompt" panel for make_podcast/make_storybook --
 * sits above the manual editor(s) it fills (TurnListField for podcast;
 * CharacterListField + SceneListField for storybook). Calls
 * POST /v1/assist/draft-podcast or /v1/assist/draft-storybook and writes
 * the result straight into the named sibling fields via onChangeAny; the
 * manual editors underneath stay fully visible and editable afterward, so
 * a generated draft is always just a starting point, matching the same
 * "still shown in an editable textarea afterward" rule ScriptAiField
 * follows for make_ugc's script.
 */
function AiDraftPanelField({ field, allValues, onChangeAny }: {
  field: Extract<Field, { kind: 'ai-draft-panel' }>;
  allValues?: Record<string, unknown>;
  onChangeAny?: (name: string, v: unknown) => void;
}) {
  const isPodcast = field.mode === 'podcast';
  const inputStyle: React.CSSProperties = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };

  const [prompt, setPrompt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [orientation, setOrientation] = useState<'positive' | 'negative' | 'neutral'>('neutral');
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);

  // Progress feedback while generating -- there's no streaming from the
  // backend (attemptDraft is one request/response), so this is an eased
  // ESTIMATE that keeps climbing toward 92% the longer it runs rather than
  // a real percent-complete, snapping to 100% only once the response
  // actually lands. Still gives real reassurance during the 10-60s a
  // podcast/storybook draft can take (see COMPOSE_DRAFT_TIMEOUT_MS /
  // STORYBOOK_DRAFT_MAX_TOKENS in assist-compose.ts) instead of a frozen
  // button with no feedback at all.
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!generating) return;
    const start = Date.now();
    setProgress(4);
    setElapsedSec(0);
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setElapsedSec(Math.floor(elapsed / 1000));
      setProgress(92 * (1 - Math.exp(-elapsed / 20000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [generating]);

  const stepLabel = (() => {
    const steps = isPodcast
      ? ['Reading your topic…', 'Thinking through the conversation…', 'Writing the dialogue…', 'Almost there — polishing…']
      : ['Reading your premise…', 'Designing the cast…', 'Writing the scenes…', 'Almost there — polishing…'];
    if (elapsedSec < 5) return steps[0];
    if (elapsedSec < 15) return steps[1];
    if (elapsedSec < 35) return steps[2];
    return steps[3];
  })();

  const generate = async () => {
    if (!prompt.trim() || generating || !onChangeAny) return;
    setGenerating(true);
    setErr(null);
    setNotes(null);
    try {
      const endpoint = isPodcast ? '/api/v1/assist/draft-podcast' : '/api/v1/assist/draft-storybook';
      const body = isPodcast
        ? { topic: prompt.trim(), source_url: sourceUrl.trim() || undefined, orientation }
        : { premise: prompt.trim(), source_url: sourceUrl.trim() || undefined };
      const resp = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as { error?: { message?: string } })?.error?.message;
        setErr(typeof msg === 'string' ? msg : `Could not generate (HTTP ${resp.status}) — try again.`);
        return;
      }
      if (isPodcast) {
        const turns = Array.isArray(data.turns) ? data.turns : [];
        if (turns.length) onChangeAny('script', turns);
        if (typeof data.room === 'string' && data.room.trim()) onChangeAny('room', data.room);
      } else {
        const characters = Array.isArray(data.characters) ? (data.characters as Array<{ name?: string; description?: string }>) : [];
        const scenes = Array.isArray(data.scenes) ? data.scenes : [];
        if (characters.length) {
          onChangeAny(
            'characters',
            characters.map((c) => ({ name: c.name ?? '', description: c.description ?? '', ref: '', ref_base64: '' })),
          );
        }
        if (scenes.length) onChangeAny('scenes', scenes);
        const title = typeof data.title === 'string' ? data.title.trim() : '';
        if (title && !String(allValues?.title ?? '').trim()) onChangeAny('title', title);
      }
      if (Array.isArray(data.warnings) && data.warnings.length) setNotes(data.warnings as string[]);
      // Let the bar visibly complete instead of vanishing mid-fill.
      setProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.25)' }}>
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" style={{ color: '#A78BFA' }} />
        <span className="text-[12px] font-semibold" style={{ color: '#E9E9F0' }}>{field.label}</span>
      </div>
      <textarea
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={isPodcast ? 'What are they discussing? e.g. "whether remote work is actually more productive"' : 'What is the story about? e.g. "a shy fox who learns to make friends at a forest picnic"'}
        style={inputStyle}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="Website / blog / page URL (optional)"
          style={{ ...inputStyle, flex: 1 }}
        />
        {isPodcast && (
          <select value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)} style={{ ...inputStyle, width: 'auto', flexShrink: 0 }}>
            <option value="neutral">Neutral</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
        )}
        <button
          type="button"
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-opacity disabled:opacity-40"
          style={{ backgroundColor: 'rgba(167,139,250,0.18)', border: '1px solid rgba(167,139,250,0.4)', color: '#A78BFA' }}
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? 'Generating…' : isPodcast ? 'Generate conversation' : 'Generate story'}
        </button>
      </div>
      {err && <span className="text-[11px]" style={{ color: '#F87171' }}>{err}</span>}
      {notes?.map((n) => (
        <span key={n} className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{n}</span>
      ))}
      {field.help && <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{field.help}</span>}
      {generating && (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7C3AED, #A78BFA)', transition: 'width 400ms ease-out' }}
            />
          </div>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {stepLabel}{elapsedSec >= 3 ? ` (${elapsedSec}s)` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
