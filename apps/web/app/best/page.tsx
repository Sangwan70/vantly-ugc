// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Best UGC Tools — What to Look For — Vantly UGC',
  description: 'A buyer’s guide to evaluating AI UGC video tools, and where Vantly UGC fits.',
};

const CRITERIA: Array<{ title: string; desc: string }> = [
  {
    title: 'Agent- and API-first',
    desc: 'Can it be driven from the tools your team already uses — Claude, Claude Code, ChatGPT, or a plain HTTP call — not just a web form?',
  },
  {
    title: 'Transparent credits',
    desc: 'Can you see exactly what a render costs before you commit, and regenerate just the part that needs fixing?',
  },
  {
    title: 'Export quality',
    desc: 'Does it ship production-grade 1080p with captions and social-ready framing, or a rough draft you still have to finish elsewhere?',
  },
  {
    title: 'Format flexibility',
    desc: 'Straight talking-head UGC, picture-in-picture app demos, and narrated B-roll should all come from one pipeline.',
  },
  {
    title: 'Ownership and self-hosting',
    desc: 'Can you run the whole pipeline on your own infrastructure with your own storage and API keys, if you need to?',
  },
];

export default function BestUgcToolsPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Buyer's guide"
        title="What to look for in an AI UGC video tool"
        lede="There are a lot of AI UGC generators out there. Here's the criteria we think actually matter — and how Vantly UGC approaches each one."
      />

      <section className="mx-auto w-full max-w-4xl px-6 pb-24">
        <div className="space-y-6">
          {CRITERIA.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border px-6 py-6 sm:px-8 sm:py-7"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          We keep this page to criteria rather than head-to-head competitor claims, since
          pricing and feature sets change often — see each tool&apos;s own site for current specifics.
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
