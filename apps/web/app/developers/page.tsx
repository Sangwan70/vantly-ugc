// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Developers — Vantly UGC',
  description: 'Build UGC video generation into your product — CLI, MCP server, SDKs, and a plain HTTP API.',
};

const ENTRY_POINTS: Array<{ href: string; title: string; desc: string }> = [
  { href: '/cli', title: 'CLI', desc: 'npm install -g vantly-ugc-cli — script it, pipe it, drop it into CI.' },
  { href: '/mcp', title: 'MCP Server', desc: 'Give Claude Code, Cursor, or Windsurf a create_video tool.' },
  { href: '/sdk/typescript', title: 'TypeScript SDK', desc: '@vantly-ugc/sdk — a typed client for Node or the edge.' },
  { href: '/sdk/python', title: 'Python SDK', desc: 'pip install vantly-ugc — sync and async clients.' },
  { href: '/ugc-video-api', title: 'HTTP API', desc: 'One POST in, one video URL out. No SDK required.' },
  { href: '/docs/api-reference', title: 'API Reference', desc: 'Every endpoint, request, and response shape.' },
];

export default function DevelopersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="For developers"
        title="Build UGC video generation into your product"
        lede="Connect from your agent, terminal, or product workflow — pick the integration that fits your stack."
      />

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ENTRY_POINTS.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="block rounded-2xl border px-6 py-6 transition-colors hover:border-white/20"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <h3 className="text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {entry.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {entry.desc}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
