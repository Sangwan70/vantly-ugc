// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * "Prompt Examples" tab of /dashboard/gallery — a browsable, category-wise
 * library of ready-to-adapt make_ugc / make_product_in_hands / make_podcast
 * / make_storybook prompts, each built around a placeholder character (a
 * dummy name + one-line persona) instead of a real saved one. The point is
 * to let a user SEE what a good prompt looks like for a given ad style
 * before writing their own — the same job SAMPLE_PROMPTS (the composer's
 * quick-start chips) does, but deeper: many examples, grouped by category,
 * browsable on their own page rather than a handful of inline chips.
 *
 * "Use this" hands the example straight to the Agent composer via a
 * `?example=<id>` deep link (see /dashboard/agent's handling of that param)
 * — the same "land in an editable textarea, never auto-send" rule every
 * other prompt-application path in this app follows.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { PROMPT_EXAMPLE_CATEGORIES, type PromptExample, type PromptExampleCategory } from '@/lib/sample-prompts';

function SettingsPills({ settings }: { settings?: Record<string, string | number | boolean> }) {
  if (!settings) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(settings).map(([k, v]) => (
        <span key={k} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>{k}:</span> {String(v)}
        </span>
      ))}
    </div>
  );
}

function ExampleBody({ example }: { example: PromptExample }) {
  if (example.script) {
    return <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>&ldquo;{example.script}&rdquo;</p>;
  }
  if (example.introLine || example.narrationLine) {
    return (
      <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
        <p>&ldquo;{example.introLine}&rdquo;</p>
        <p style={{ color: 'rgba(255,255,255,0.35)' }}>— then b-roll takes over while this narration plays —</p>
        <p>&ldquo;{example.narrationLine}&rdquo;</p>
      </div>
    );
  }
  if (example.turns?.length) {
    return (
      <div className="flex flex-col gap-1 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {example.turns.map((t, i) => (<p key={i}><span style={{ color: '#A78BFA' }}>{t.speaker}:</span> &ldquo;{t.line}&rdquo;</p>))}
      </div>
    );
  }
  if (example.scenes?.length) {
    return (
      <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {example.artStyle && <p style={{ color: 'rgba(255,255,255,0.45)' }}>Art style: {example.artStyle}</p>}
        {example.scenes.map((s, i) => (
          <p key={i}><span style={{ color: '#A78BFA' }}>{i + 1}. {s.speaker}</span> — {s.visual} — &ldquo;{s.line}&rdquo;</p>
        ))}
      </div>
    );
  }
  return null;
}

function ExampleCard({ example }: { example: PromptExample }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl p-4" style={{ background: '#14151F', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[13.5px] font-semibold" style={{ color: '#E9E9F0' }}>{example.title}</h4>
          {example.character && (
            <p className="mt-0.5 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              <span style={{ color: '#A78BFA' }}>{example.character}</span>{example.persona ? ` — ${example.persona}` : ''}
            </p>
          )}
        </div>
        <Link
          href={`/dashboard/agent?example=${encodeURIComponent(example.id)}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-opacity hover:opacity-90"
          style={{ background: '#A78BFA', color: '#0F1015' }}
        >
          Use this <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <ExampleBody example={example} />
      {example.notes && <p className="text-[11.5px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{example.notes}</p>}
      <SettingsPills settings={example.settings} />
    </div>
  );
}

function CategorySection({ category }: { category: PromptExampleCategory }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[16px] font-semibold" style={{ color: '#E9E9F0' }}>{category.emoji} {category.label}</h3>
        <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{category.description}</p>
        {category.categoryNote && <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{category.categoryNote}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {category.examples.map((ex) => (<ExampleCard key={ex.id} example={ex} />))}
      </div>
    </div>
  );
}

export function PromptExamplesTab() {
  const [activeKey, setActiveKey] = useState<string | 'all'>('all');
  const categories = activeKey === 'all' ? PROMPT_EXAMPLE_CATEGORIES : PROMPT_EXAMPLE_CATEGORIES.filter((c) => c.key === activeKey);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#A78BFA' }} />
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Every character here is a placeholder. Pick an example, go create a matching character on{' '}
          <Link href="/dashboard/gallery?tab=brand" className="underline" style={{ color: '#A78BFA' }}>your Brand Kit</Link> or via the Agent chat, then swap it in before you generate.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setActiveKey('all')} className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ background: activeKey === 'all' ? '#A78BFA' : '#15161D', color: activeKey === 'all' ? '#0F1015' : 'rgba(255,255,255,0.62)', border: '1px solid rgba(255,255,255,0.08)' }}>
          All categories
        </button>
        {PROMPT_EXAMPLE_CATEGORIES.map((c) => (
          <button key={c.key} type="button" onClick={() => setActiveKey(c.key)} className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors" style={{ background: activeKey === c.key ? '#A78BFA' : '#15161D', color: activeKey === c.key ? '#0F1015' : 'rgba(255,255,255,0.62)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-10">
        {categories.map((c) => (<CategorySection key={c.key} category={c} />))}
      </div>
    </div>
  );
}
