// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Python SDK — Vantly UGC',
  description: 'Generate AI UGC videos with talking heads, B-roll, and subtitles programmatically, from Python.',
};

export default function PythonSdkPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="pip install vantly-ugc"
        title="Python SDK"
        lede="A typed client over the Vantly UGC HTTP API, with a sync and an async client."
      />

      <section className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-24">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Install
          </h2>
          <div className="mt-4">
            <CodeBlock label="pip">{`pip install vantly-ugc`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Usage
          </h2>
          <div className="mt-4">
            <CodeBlock label="python">{`from vantly_ugc import VantlyUgc

client = VantlyUgc(api_key="YOUR_API_KEY")

# Submits the job and polls until it completes.
result = client.create_video(
    script="Stop scrolling. This tool changed everything for me.",
    actor_slug="sofia",
)

print(result["video_url"])`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Fire-and-poll
          </h2>
          <div className="mt-4">
            <CodeBlock label="python">{`job = client.submit_video(script="...")
status = client.get_video_status(job["job_id"])
# status["status"]: "submitted" | "processing" | "completed" | "failed"`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Context manager
          </h2>
          <div className="mt-4">
            <CodeBlock label="python">{`with VantlyUgc(api_key="YOUR_API_KEY") as client:
    actors = client.list_actors()`}</CodeBlock>
          </div>
        </div>

        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Working in TypeScript instead? See the{' '}
          <Link href="/sdk/typescript" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            TypeScript SDK
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
