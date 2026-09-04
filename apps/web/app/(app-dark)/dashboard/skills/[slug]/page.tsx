// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/skills/[slug] — focused per-skill page.
 *
 * Left column: form + active run for THIS skill (polled).
 * Right column: MCP / REST / CLI install snippets.
 * Bottom: recent runs of this skill (filtered via /v1/me/gallery).
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { use } from 'react';
import { Loader2, Play, ArrowLeft, ExternalLink, Copy, Check } from 'lucide-react';
import { metaFor } from '../_meta';
import { FORMS, type Field } from '../_forms';

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

interface SkillEntry {
  slug: string;
  name: string;
  version: string;
  description: string;
  primitive: string;
}

interface RunResult {
  composed: boolean;
  id: string;
  status: string;
  current_step?: string | null;
  steps?: Array<{ primitive: string; status: string; artifacts?: Array<{ url: string }> }>;
  artifacts?: Array<{ url: string }>;
  final_output?: Record<string, unknown> | null;
  error?: { code: string; message: string | null } | null;
}

interface RecentItem {
  id: string;
  source: string;
  primitive: string | null;
  status: string;
  created_at: string;
  media_url: string | null;
  thumbnail_url: string | null;
}

const TERMINAL = new Set(['succeeded', 'completed', 'success', 'failed', 'canceled', 'cancelled']);

export default function SkillDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [skill, setSkill] = useState<SkillEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [activeRun, setActiveRun] = useState<RunResult | null>(null);

  // Load skill metadata
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/skills', { credentials: 'include' });
        if (!r.ok) { setError(`skills ${r.status}`); return; }
        const j = (await r.json()) as { skills: SkillEntry[] };
        const found = j.skills.find((s) => s.slug === slug);
        if (!found) { setError(`Skill "${slug}" not found`); return; }
        setSkill(found);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [slug]);

  // Load recent runs for this skill
  const reloadRecent = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '10', skill: slug, primitive: slug });
      const r = await fetch(`/api/v1/me/gallery?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { items?: RecentItem[] };
      // For composed skill, we want the skill-run rows (source=vnext_skill).
      // For primitives, we want primitive-run rows (source=vnext_primitive).
      const filtered = (j.items ?? []).filter((it) => it.primitive === slug);
      setRecent(filtered);
    } catch { /* ignore */ }
  }, [slug]);
  useEffect(() => { void reloadRecent(); }, [reloadRecent]);

  // Poll active run
  useEffect(() => {
    if (!activeRun || TERMINAL.has(activeRun.status)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const url = activeRun.composed
          ? `/api/v1/skills/runs/${encodeURIComponent(activeRun.id)}`
          : `/api/v1/primitives/runs/${encodeURIComponent(activeRun.id)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (r.ok) {
          const d = (await r.json()) as any;
          const next: RunResult = activeRun.composed
            ? { composed: true, id: d.skill_run_id ?? activeRun.id, status: d.status ?? '?', current_step: d.current_step ?? null, steps: d.steps ?? [], final_output: d.final_output ?? null, error: d.error ?? null }
            : { composed: false, id: d.run_id ?? activeRun.id, status: d.status ?? '?', artifacts: d.artifacts ?? [], error: d.error ?? null };
          setActiveRun(next);
          if (TERMINAL.has(next.status)) {
            void reloadRecent();
            return;
          }
        }
      } catch {}
      setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeRun, reloadRecent]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <Link href="/dashboard/skills" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Skill Center
        </Link>
        <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <div className="flex h-48 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </div>
      </div>
    );
  }

  const meta = metaFor(skill.slug);
  const form = FORMS[skill.slug];

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <Link href="/dashboard/skills" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Skill Center
      </Link>

      <div className="mt-4 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" style={{ color: '#E9E9F0' }}>{skill.name}</h1>
        <div className="flex items-center gap-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span>{meta.cost}</span>
          <span>·</span>
          <span>{meta.time}</span>
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{skill.description}</p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <RunPanel skill={skill} form={form} activeRun={activeRun} onLaunched={setActiveRun} />
        <InstallPanel skill={skill} />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Recent runs</h2>
        {recent === null ? (
          <div className="mt-3 flex h-24 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </div>
        ) : recent.length === 0 ? (
          <div className="mt-3 rounded-2xl p-6 text-center text-sm" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D', color: 'rgba(255,255,255,0.5)' }}>
            No runs yet. Run the skill above to see them here.
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recent.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-4 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D' }}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{new Date(it.created_at).toLocaleString()}</span>
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{it.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px]" style={{ color: it.status === 'succeeded' ? '#34D399' : it.status === 'failed' ? '#F87171' : '#A78BFA' }}>{it.status}</span>
                  {it.media_url && (
                    <a href={it.media_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" style={{ color: '#A78BFA' }}>
                      open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunPanel({
  skill,
  form,
  activeRun,
  onLaunched,
}: {
  skill: SkillEntry;
  form?: { fields: Field[]; composed: boolean };
  activeRun: RunResult | null;
  onLaunched: (r: RunResult) => void;
}) {
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (!form) return o;
    for (const f of form.fields) {
      if (f.kind === 'select') o[f.name] = f.defaultValue ?? f.options[0];
      else if (f.kind === 'number-select') o[f.name] = f.defaultValue ?? f.options[0];
      else if (f.kind === 'boolean') o[f.name] = f.defaultValue ?? false;
      else if (f.kind === 'character-list' || f.kind === 'scene-list') o[f.name] = [];
      else o[f.name] = '';
    }
    return o;
  }, [form]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSubmitErr(null);
    setSubmitting(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
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
      onLaunched({ composed: form.composed, id, status: 'submitted' });
    } catch (err) {
      setSubmitErr((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Run</h2>
      {form ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {form.fields.map((f) => (
            <FieldRow key={f.name} field={f} value={values[f.name]} allValues={values} onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))} />
          ))}
          {submitErr && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
              {submitErr}
            </div>
          )}
          <div className="flex items-center justify-end">
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors" style={{ backgroundColor: submitting ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run skill
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          No form configured for this skill. Call <code>POST /v1/skills/{skill.slug}/run</code> directly.
        </p>
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

function InstallPanel({ skill }: { skill: SkillEntry }) {
  const restSnippet = `curl -X POST https://api.vantly-ugc.com/v1/skills/${skill.slug}/run \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ /* see input schema */ }'`;

  const cliSnippet = `vantly-ugc skills run ${skill.slug} \\
  --input '{ /* see input schema */ }' --wait`;

  const mcpSnippet = JSON.stringify({
    mcpServers: {
      'vantly-ugc': {
        command: 'npx',
        args: ['-y', '-p', 'vantly-ugc-mcp-server@latest', 'vantly-ugc-mcp'],
        env: { VANTLY_UGC_API_KEY: '${VANTLY_UGC_API_KEY}' },
      },
    },
  }, null, 2);

  const ghLink = `https://github.com/Sangwan70/vantly-ugc/blob/main/public-skill/skills/${skill.slug.replace(/_/g, '-')}/SKILL.md`;

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Use from anywhere</h2>
      <SnippetBlock title="REST" code={restSnippet} />
      <SnippetBlock title="CLI" code={cliSnippet} />
      <SnippetBlock title="MCP (Claude.ai / Cursor / Claude Code)" code={mcpSnippet} />
      <a href={ghLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" style={{ color: '#A78BFA' }}>
        full SKILL.md on gitroom <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function SnippetBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {}
          }}
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: copied ? '#34D399' : 'rgba(255,255,255,0.5)' }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)', color: '#E9E9F0' }}>{code}</pre>
    </div>
  );
}

function FieldRow({ field, value, onChange, allValues }: { field: Field; value: unknown; onChange: (v: unknown) => void; allValues?: Record<string, unknown> }) {
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
