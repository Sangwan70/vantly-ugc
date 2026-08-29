// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Blog — Vantly UGC',
  description: 'Notes from the Vantly UGC team on building an agent-first UGC video pipeline.',
};

const POSTS: Array<{ title: string; excerpt: string }> = [
  {
    title: 'Why we built UGC generation agent-first',
    excerpt:
      'Most video tools assume a human at a web form. We started from the opposite end — an agent that can call a tool — and built the web app as one more client of the same API, not the other way around.',
  },
  {
    title: 'What "production-grade" means for a 15-second video',
    excerpt:
      'Captions that don\'t drift, framing that survives a crop to 9:16, audio that isn\'t clipped — the unglamorous details that separate a usable clip from a draft.',
  },
  {
    title: 'Composing skills instead of hardcoding pipelines',
    excerpt:
      'Make Portrait, Make Character Sheet, Make Simple Selfie, Make Subtitles — each is one callable skill. Make UGC Video composes several of them so you can call one tool instead of orchestrating four.',
  },
];

export default function BlogPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Blog"
        title="Notes from the team"
        lede="Short write-ups on how the pipeline is built and why."
      />

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="space-y-5">
          {POSTS.map((post) => (
            <div
              key={post.title}
              className="rounded-2xl border px-6 py-6"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <p
                className="text-xs font-medium uppercase tracking-[0.15em]"
                style={{ color: 'var(--cryptix-purple)' }}
              >
                Vantly UGC Team
              </p>
              <h2 className="mt-2 text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {post.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {post.excerpt}
              </p>
            </div>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
