// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'UGC Video API — Vantly UGC',
  description: 'Send an HTTP request to Vantly UGC and receive a ready-to-use video response.',
};

export default function UgcVideoApiPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="HTTP API"
        title="One request in, one video out"
        lede="No agent or SDK required — send an HTTP request to Vantly UGC and receive a ready-to-use video response."
      />

      <section className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-24">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Submit a video job
          </h2>
          <div className="mt-4">
            <CodeBlock label="bash">{`curl -X POST https://api.vantly-ugc.com/v1/generate/ugc_video \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "script": "Stop scrolling. This tool changed everything for me.",
    "actor_slug": "sofia"
  }'`}</CodeBlock>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            Returns immediately with a <code>job_id</code>, an estimated duration, and
            the credits deducted.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Check job status
          </h2>
          <div className="mt-4">
            <CodeBlock label="bash">{`curl https://api.vantly-ugc.com/v1/videos/$JOB_ID \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY"`}</CodeBlock>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            <code>status</code> moves through <code>submitted → processing → completed</code>{' '}
            (or <code>failed</code>); once completed, <code>video_url</code> points at the
            finished render.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            List actors
          </h2>
          <div className="mt-4">
            <CodeBlock label="bash">{`curl https://api.vantly-ugc.com/v1/actors \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY"`}</CodeBlock>
          </div>
        </div>

        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Prefer a typed client?{' '}
          <Link href="/sdk/typescript" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            TypeScript
          </Link>{' '}
          and{' '}
          <Link href="/sdk/python" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            Python
          </Link>{' '}
          SDKs wrap this same API. The full spec is available at{' '}
          <Link href="/openapi.json" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            /openapi.json
          </Link>
          .
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
