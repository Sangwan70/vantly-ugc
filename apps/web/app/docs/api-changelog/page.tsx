// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'API Changelog — Vantly UGC',
  description: 'Current package versions for the Vantly UGC CLI, MCP server, and SDKs.',
};

const PACKAGES: Array<{ name: string; version: string }> = [
  { name: 'vantly-ugc-cli', version: '1.18.5' },
  { name: 'vantly-ugc-mcp-server', version: '0.7.9' },
  { name: '@vantly-ugc/sdk (TypeScript)', version: '0.5.5' },
  { name: 'vantly-ugc (Python)', version: '0.4.1' },
];

export default function ApiChangelogPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Changelog"
        title="Current package versions"
        lede="This self-hosted instance tracks the versions below. Detailed release notes live alongside each package in the repository."
      />

      <section className="mx-auto w-full max-w-2xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {PACKAGES.map((pkg, i) => (
            <div
              key={pkg.name}
              className="flex items-center justify-between px-5 py-4"
              style={{
                background: 'var(--cryptix-surface)',
                borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <code className="text-sm" style={{ color: 'var(--cryptix-text)' }}>
                {pkg.name}
              </code>
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'var(--cryptix-surface-2)', color: 'var(--cryptix-purple)' }}
              >
                v{pkg.version}
              </span>
            </div>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
