// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * "Prompt & inputs" section for the run-detail page
 * (dashboard/skills/runs/[id]/page.tsx) — shows exactly what was submitted
 * to generate this run: every field's filled-in value, with the SAME
 * human labels the Skill Center form used to collect it (see _forms.ts),
 * not a raw JSON dump of the dispatch payload.
 *
 * The backend already exposes this (GET /v1/skills/runs/:id/input for a
 * composed run, GET /v1/primitives/runs/:id/input for a standalone one —
 * both proxied same-origin) but until now only _retry.tsx's RetryButton
 * ever fetched it, purely to prefill a new attempt — nothing rendered it
 * for the person to actually read. Fetched once on mount, independent of
 * the run's 4s status poll (see input/route.ts's own comment: no business
 * carrying raw user content, which can include reference-image URLs, on
 * every poll tick).
 *
 * Field labels/order come from _forms.ts's FORMS map (the same source of
 * truth the original submission form used) when the skill/primitive has
 * one; anything that map doesn't cover — an unmapped skill (e.g.
 * make_broll_talking_head has no Skill Center form, agent-only), or an
 * extra key the form didn't declare — still renders, just with a
 * titleCased fallback label, so nothing the run was actually given is
 * ever silently hidden.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Loader2 } from 'lucide-react';
import { FORMS, type Field } from './_forms';

const PRIMITIVE_ID_TO_SKILL_SLUG: Record<string, string> = {
  portrait_gpt2: 'make_portrait',
  character_sheet_gpt2: 'make_character_sheet',
  simple_selfie: 'make_simple_selfie',
  product_in_hands: 'make_product_in_hands',
  wireframe_gpt2: 'make_wireframe',
  lip_sync: 'make_lip_sync',
  subtitles: 'make_subtitles',
  subtitles_v2: 'make_subtitles',
};

const LIST_ITEM_LABELS: Record<string, Record<string, string>> = {
  'character-list': { name: 'Name', description: 'Description', ref: 'Reference image / character' },
  'scene-list': { speaker: 'Speaker', line: 'Line', visual_description: 'Visual description' },
  'turn-list': { speaker: 'Speaker', line: 'Line' },
};

function titleCase(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenFields(fields: Field[], labels: Record<string, string>, listKinds: Record<string, string>): void {
  for (const f of fields) {
    switch (f.kind) {
      case 'expandable':
        flattenFields([f.child], labels, listKinds);
        break;
      case 'toggle':
        labels[f.name] = f.label;
        if (f.children) flattenFields(f.children, labels, listKinds);
        break;
      case 'character-source':
        labels[f.generateField] = `${f.label} (description)`;
        labels[f.uploadField] = `${f.label} (uploaded photo)`;
        labels[f.existingField] = `${f.label} (saved character)`;
        break;
      case 'ai-draft-panel':
        break; // UI-only key, stripped before submit — never in real input
      case 'scene-list':
      case 'character-list':
      case 'turn-list':
        labels[f.name] = f.label;
        listKinds[f.name] = f.kind;
        break;
      default:
        labels[f.name] = f.label;
    }
  }
}

function resolveFormMeta(skillOrPrimitive: string | undefined, composed: boolean) {
  const slug = !skillOrPrimitive ? undefined : composed ? skillOrPrimitive : PRIMITIVE_ID_TO_SKILL_SLUG[skillOrPrimitive];
  const form = slug ? FORMS[slug] : undefined;
  const labels: Record<string, string> = {};
  const listKinds: Record<string, string> = {};
  if (form) flattenFields(form.fields, labels, listKinds);
  return { labels, listKinds, order: Object.keys(labels) };
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp)(\?|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov)(\?|$)/i;
const HTTP_URL_RE = /^https?:\/\//i;

function MediaOrText({ value }: { value: string }) {
  if (value.startsWith('data:image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt="" className="h-20 w-20 rounded-lg object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
    );
  }
  if (HTTP_URL_RE.test(value) && (IMAGE_RE.test(value) || VIDEO_RE.test(value))) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="group relative inline-block h-20 w-20 overflow-hidden rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        {VIDEO_RE.test(value) ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={value} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        )}
        <span className="absolute right-1 top-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <ExternalLink className="h-2.5 w-2.5" style={{ color: '#fff' }} />
        </span>
      </a>
    );
  }
  if (HTTP_URL_RE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="break-all text-[13px] underline" style={{ color: '#A78BFA' }}>
        {value}
      </a>
    );
  }
  if (value.length > 80) {
    return <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: '#E9E9F0' }}>{value}</p>;
  }
  return <span className="text-[13px]" style={{ color: '#E9E9F0' }}>{value}</span>;
}

function ScalarValue({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>;
  if (typeof value === 'boolean') return <span className="text-[13px]" style={{ color: '#E9E9F0' }}>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span className="text-[13px]" style={{ color: '#E9E9F0' }}>{value}</span>;
  if (typeof value === 'string') return <MediaOrText value={value} />;
  return <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{JSON.stringify(value)}</span>;
}

function ListField({ label, items, itemLabels }: { label: string; items: unknown[]; itemLabels?: Record<string, string> }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</div>
      <ol className="mt-2 flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-lg px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D' }}>
            {item && typeof item === 'object' ? (
              <div className="flex flex-col gap-1.5">
                {Object.entries(item as Record<string, unknown>).map(([k, v]) => {
                  if (v == null || v === '') return null;
                  return (
                    <div key={k} className="flex flex-wrap items-baseline gap-2">
                      <span className="shrink-0 text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {itemLabels?.[k] ?? titleCase(k)}:
                      </span>
                      <ScalarValue value={v} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <ScalarValue value={item} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface RunInputViewProps {
  /** For a composed run: the skill slug (body.skill). For a standalone run: the primitive id (body.primitive). */
  skillOrPrimitive: string | undefined;
  composed: boolean;
  runId: string;
}

export function RunInputView({ skillOrPrimitive, composed, runId }: RunInputViewProps) {
  const [input, setInput] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = composed
          ? `/api/v1/skills/runs/${encodeURIComponent(runId)}/input`
          : `/api/v1/primitives/runs/${encodeURIComponent(runId)}/input`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) { if (!cancelled) setInput(null); return; }
        const data = (await resp.json()) as { input?: Record<string, unknown> | null };
        if (!cancelled) setInput(data.input ?? null);
      } catch {
        if (!cancelled) setInput(null);
      }
    })();
    return () => { cancelled = true; };
  }, [runId, composed]);

  if (input === null) return null; // couldn't load — fail quiet, the rest of the page still works
  if (input === undefined) {
    return (
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Prompt &amp; inputs</h2>
        <div className="mt-3 flex h-16 items-center justify-center rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
        </div>
      </section>
    );
  }

  const { labels, listKinds, order } = resolveFormMeta(skillOrPrimitive, composed);
  const knownKeys = new Set(order);
  const extraKeys = Object.keys(input).filter((k) => !knownKeys.has(k) && !k.startsWith('_'));
  const allKeys = [...order.filter((k) => k in input), ...extraKeys];
  if (allKeys.length === 0) return null;

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Prompt &amp; inputs</h2>
        {open ? <ChevronUp className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.4)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.4)' }} />}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#0F1015' }}>
          {allKeys.map((key) => {
            const value = input[key];
            if (value == null || value === '') return null;
            const label = labels[key] ?? titleCase(key);
            const listKind = listKinds[key];
            if (Array.isArray(value)) {
              return <ListField key={key} label={label} items={value} itemLabels={listKind ? LIST_ITEM_LABELS[listKind] : undefined} />;
            }
            return (
              <div key={key} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                <span className="shrink-0 text-[11px] font-medium sm:w-40" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
                <div className="min-w-0 flex-1"><ScalarValue value={value} /></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
