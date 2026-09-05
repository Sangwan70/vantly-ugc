// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { getStaticPage } from '@/lib/content/get-page';
import { PricingCards } from '@/components/pricing-cards';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Pricing — Vantly UGC',
  description: 'Simple, transparent pricing for Vantly UGC. Pick a plan, generate videos, upgrade or cancel anytime.',
};

const PRICING_FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'How does the credit system work?',
    a: 'Credits are used when generating or regenerating video assets. Usage depends on the requested production work and is tracked in your account.',
  },
  {
    q: 'Can I adjust a video without starting over?',
    a: 'Yes. Regenerate individual parts such as the script, actor, voice, captions, or format while keeping the rest unchanged.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes — plans are month to month with no long-term contract. Cancel from your billing settings whenever you like.',
  },
];

export default async function PricingPage() {
  const page = await getStaticPage('pricing');

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Pricing"
        title={page?.title || 'Simple, transparent pricing'}
        lede={page?.content_html?.trim() || 'Pick a plan, generate videos, upgrade or cancel anytime.'}
        imageUrl={page?.hero_image_url}
        videoUrl={page?.hero_video_url}
        overlayOpacity={page?.hero_overlay_opacity ?? 45}
      />

      <section className="mx-auto w-full max-w-6xl px-6 pb-16">
        <PricingCards />
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="space-y-4">
          {PRICING_FAQS.map((item) => (
            <div
              key={item.q}
              className="rounded-2xl border px-6 py-5"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <p className="text-base font-medium" style={{ color: 'var(--cryptix-text)' }}>
                {item.q}
              </p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      <CtaSection primaryText={page?.cta_primary_text} secondaryText={page?.cta_secondary_text} />
    </MarketingShell>
  );
}
