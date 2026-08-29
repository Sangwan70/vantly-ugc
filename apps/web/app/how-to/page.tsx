// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'UGC Guides — Vantly UGC',
  description: 'Practical guides for producing better AI UGC video with Vantly UGC.',
};

const GUIDES: Array<{ title: string; desc: string }> = [
  {
    title: 'Writing a UGC script that actually converts',
    desc: 'Hook, problem, proof, call to action — the beats that make a 10-second talking-head video watchable, and how to pace them at 2-4 words per second.',
  },
  {
    title: 'Choosing an actor and voice',
    desc: 'How actor demographics, delivery style, and pacing affect how a script lands, and when to let Vantly UGC pick automatically versus locking a specific persona.',
  },
  {
    title: 'B-roll vs. picture-in-picture: when to use each',
    desc: 'Straight talking-head, narrated B-roll underneath, or a phone/app screen in frame — matching the format to the message.',
  },
  {
    title: 'Getting captions right',
    desc: 'Hormozi-style, TikTok-style, or minimal — how caption style affects watch time, and when to auto-transcribe versus supply your own script.',
  },
  {
    title: 'Batch-testing creative variations',
    desc: 'Generating several hooks or formats from one campaign brief so you can test creative before committing production budget.',
  },
  {
    title: 'Self-hosting Vantly UGC',
    desc: 'A quick overview of running the full pipeline on your own infrastructure — your own storage, your own API keys, one Docker image.',
  },
];

export default function HowToPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="UGC guides"
        title="Practical guides for better UGC video"
        lede="Short, hands-on write-ups for getting more out of every generation."
      />

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="space-y-5">
          {GUIDES.map((guide) => (
            <div
              key={guide.title}
              className="rounded-2xl border px-6 py-6"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <h2 className="text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {guide.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {guide.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
