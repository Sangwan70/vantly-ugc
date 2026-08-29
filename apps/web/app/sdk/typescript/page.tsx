// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'TypeScript SDK — Vantly UGC',
  description: 'Generate AI UGC videos with talking heads, B-roll, and subtitles programmatically, from TypeScript or JavaScript.',
};

export default function TypeScriptSdkPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="@vantly-ugc/sdk"
        title="TypeScript SDK"
        lede="A thin, typed client over the Vantly UGC HTTP API — generate videos, check job status, and browse actors from Node or the edge."
      />

      <section className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-24">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Install
          </h2>
          <div className="mt-4">
            <CodeBlock label="npm">{`npm install @vantly-ugc/sdk`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Usage
          </h2>
          <div className="mt-4">
            <CodeBlock label="typescript">{`import { VantlyUgc } from '@vantly-ugc/sdk';

const client = new VantlyUgc({ apiKey: process.env.VANTLY_UGC_API_KEY! });

// Submits the job and polls until it completes.
const video = await client.createVideo({
  script: 'Stop scrolling. This tool changed everything for me.',
  actor_slug: 'sofia',
});

console.log(video.video_url);`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Fire-and-poll
          </h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            Prefer to submit and check back later instead of blocking on <code>createVideo</code>?
          </p>
          <div className="mt-4">
            <CodeBlock label="typescript">{`const job = await client.submitVideo({ script: '...' });

const status = await client.getVideoStatus(job.job_id);
// status.status: 'submitted' | 'processing' | 'completed' | 'failed'
// status.video_url: string | null`}</CodeBlock>
          </div>
        </div>

        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Working in Python instead? See the{' '}
          <Link href="/sdk/python" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            Python SDK
          </Link>
          , or read the full{' '}
          <Link href="/docs/api-reference" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            API reference
          </Link>
          .
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
