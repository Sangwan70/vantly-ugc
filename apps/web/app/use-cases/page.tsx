// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Use Cases — Vantly UGC',
  description: 'What teams build with Vantly UGC: creator-style ads, product launches, app demos, and more.',
};

const USE_CASES: Array<{ title: string; desc: string }> = [
  {
    title: 'Creator-style UGC ads',
    desc: 'Talking-head, testimonial-style spots that feel native to TikTok and Reels — scripted, voiced, and captioned automatically.',
  },
  {
    title: 'Product launch videos',
    desc: 'Turn a product brief or release notes into a launch-ready video the moment the feature ships.',
  },
  {
    title: 'App and product demos',
    desc: 'Show your phone or product screen with picture-in-picture presenter footage, no screen-recording rig required.',
  },
  {
    title: 'Social ad variations',
    desc: 'Generate a batch of format and hook variations from one brief so you can test creative at scale.',
  },
  {
    title: 'Explainers',
    desc: 'Narrated, B-roll-driven explainer videos for onboarding, support, or top-of-funnel content.',
  },
  {
    title: 'Campaign concept testing',
    desc: 'Try several angles on the same campaign brief before committing production budget to one direction.',
  },
];

export default function UseCasesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Use cases"
        title="Built for every UGC video your team ships"
        lede="From a single prompt or brand brief, Vantly UGC produces the video format your campaign actually needs."
      />

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <div
              key={useCase.title}
              className="rounded-2xl border px-6 py-8"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {useCase.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {useCase.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
