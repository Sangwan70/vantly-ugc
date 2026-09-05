// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';
import { getStaticPage } from '@/lib/content/get-page';

export const metadata: Metadata = {
  title: 'Docs — Vantly UGC',
  description: 'API reference and changelog for building on the Vantly UGC API.',
};

const DOCS_LINKS: Array<{ href: string; title: string; desc: string }> = [
  {
    href: '/docs/api-reference',
    title: 'API Reference',
    desc: 'Every Vantly UGC API endpoint: generation, job status, actors, and character workflows.',
  },
  {
    href: '/docs/api-changelog',
    title: 'API Changelog',
    desc: "What's changed across API versions, so integrations can track updates safely.",
  },
];

export default async function DocsIndexPage() {
  const page = await getStaticPage('docs');

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Docs"
        title={page?.title || 'Build with the Vantly UGC API'}
        lede={page?.content_html?.trim() || 'Reference docs for generating video and image content from your own code.'}
        imageUrl={page?.hero_image_url}
        videoUrl={page?.hero_video_url}
        overlayOpacity={page?.hero_overlay_opacity ?? 45}
      />

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="space-y-4">
          {DOCS_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-2xl border px-6 py-6 transition-colors hover:border-white/20"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <h2 className="text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {item.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {item.desc}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <CtaSection primaryText={page?.cta_primary_text} secondaryText={page?.cta_secondary_text} />
    </MarketingShell>
  );
}
