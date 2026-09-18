// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Public-facing teaser for the Prompt Examples Library (the full,
 * category-wise version lives behind auth at Gallery > Prompt Examples,
 * apps/web/app/(app-dark)/dashboard/gallery/_prompt-examples-tab.tsx, and
 * both read from the same lib/sample-prompts.ts data). Shows one example
 * per category so a prospect sees a concrete script — not just a category
 * label — before signing up. "Try it" opens the same login modal every
 * other marketing CTA on this page uses; there's nowhere else for a
 * signed-out visitor to run a prompt.
 */

import type { MouseEvent } from 'react';
import { useLogin } from '@/components/login-context';
import { PROMPT_EXAMPLE_CATEGORIES } from '@/lib/sample-prompts';

// One example per category, kept short and script-forward for a marketing
// audience — no raw settings keys (look/aspect_ratio/etc.), which read as
// developer-facing clutter here even though they're useful in-app.
const PREVIEW_CATEGORIES = PROMPT_EXAMPLE_CATEGORIES.map((c) => ({ category: c, example: c.examples[0] }));

function previewLine(example: (typeof PREVIEW_CATEGORIES)[number]['example']): string {
  if (example.script) return example.script;
  if (example.introLine) return example.introLine;
  if (example.turns?.length) return example.turns[0].line;
  if (example.scenes?.length) return example.scenes[0].line;
  return example.notes ?? '';
}

export function PromptExamplesPreview() {
  const { openLogin } = useLogin();
  const handleTryIt = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    openLogin();
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-6 pb-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold sm:text-3xl" style={{ color: 'var(--cryptix-text)' }}>
          Prompt examples, by category
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Every ad style Vantly UGC can produce, with a real example script — swap in your own character and product once you&apos;re in.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PREVIEW_CATEGORIES.map(({ category, example }) => (
          <div key={category.key} className="flex flex-col gap-2.5 rounded-2xl p-5" style={{ background: 'var(--cryptix-surface)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--cryptix-text)' }}>{category.emoji} {category.label}</h3>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>&ldquo;{previewLine(example)}&rdquo;</p>
            <button
              type="button"
              onClick={handleTryIt}
              className="mt-1 self-start text-[12.5px] font-medium underline"
              style={{ color: 'var(--cryptix-purple)' }}
            >
              Try it
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
