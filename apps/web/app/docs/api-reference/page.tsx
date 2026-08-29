// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'API Reference — Vantly UGC',
  description: 'Every Vantly UGC API endpoint: generation, job status, actors, and character workflows.',
};

const GROUPS: Array<{ title: string; endpoints: Array<{ method: string; path: string; desc: string }> }> = [
  {
    title: 'Video generation',
    endpoints: [
      { method: 'POST', path: '/v1/generate/ugc_video', desc: 'Standard talking-head UGC video from a script.' },
      { method: 'POST', path: '/v1/generate/subtitle', desc: 'Add captions/subtitles to an existing video.' },
      { method: 'POST', path: '/v1/generate/saas_review', desc: 'SaaS/product review-style UGC video.' },
      { method: 'POST', path: '/v1/generate/show_your_app', desc: 'Actor holding a phone, showing your app screenshot.' },
      { method: 'POST', path: '/v1/generate/product_acting_ugc', desc: 'Actor presenting or reacting to a product image.' },
      { method: 'POST', path: '/v1/generate/laptop_ugc', desc: 'Actor presenting in front of a laptop screen.' },
      { method: 'POST', path: '/v1/generate/character_video', desc: 'Video using a previously generated character.' },
      { method: 'POST', path: '/v1/generate/text_to_video', desc: 'Direct text-to-video generation.' },
    ],
  },
  {
    title: 'Jobs & actors',
    endpoints: [
      { method: 'GET', path: '/v1/videos/{job_id}', desc: 'Poll a generation job for status and the final video URL.' },
      { method: 'GET', path: '/v1/actors', desc: 'List available AI actors — slugs, names, demographics.' },
    ],
  },
  {
    title: 'Characters',
    endpoints: [
      { method: 'POST', path: '/v1/character/sheet-generate', desc: 'Generate a character reference sheet.' },
      { method: 'POST', path: '/v1/character/storyboard-suggest', desc: 'Suggest a storyboard for a character.' },
      { method: 'POST', path: '/v1/character/storyboard-generate', desc: 'Generate a full character storyboard.' },
    ],
  },
];

export default function ApiReferencePage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="API reference"
        title="Every endpoint, grouped by workflow"
        lede="All endpoints are relative to https://api.vantly-ugc.com and take a Bearer API key."
      />

      <section className="mx-auto w-full max-w-4xl space-y-10 px-6 pb-16">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
              {group.title}
            </h2>
            <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              {group.endpoints.map((ep, i) => (
                <div
                  key={ep.path}
                  className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-4"
                  style={{
                    background: 'var(--cryptix-surface)',
                    borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="flex items-center gap-3 sm:w-64 sm:shrink-0">
                    <span
                      className="rounded px-2 py-0.5 text-xs font-bold"
                      style={{ background: 'var(--cryptix-purple-glow)', color: 'var(--cryptix-purple)' }}
                    >
                      {ep.method}
                    </span>
                    <code className="text-sm" style={{ color: 'var(--cryptix-text)' }}>
                      {ep.path}
                    </code>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
                    {ep.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 pb-24">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
          Authentication
        </h2>
        <div className="mt-4">
          <CodeBlock label="bash">{`curl https://api.vantly-ugc.com/v1/actors \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY"`}</CodeBlock>
        </div>
        <p className="mt-4 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Generate an API key from your dashboard settings. The full machine-readable
          spec is served at{' '}
          <Link href="/openapi.json" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            /openapi.json
          </Link>{' '}
          — see the{' '}
          <Link href="/docs/api-changelog" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            changelog
          </Link>{' '}
          for version history.
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
