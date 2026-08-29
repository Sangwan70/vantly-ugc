// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'CLI — Vantly UGC',
  description: 'Generate AI UGC videos with talking heads, B-roll, voiceover, and subtitles — from your terminal.',
};

export default function CliPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="vantly-ugc-cli"
        title="UGC video generation, from your terminal"
        lede="Talking heads, B-roll, voiceover, and subtitles — script in, video URL out. Scriptable, pipeable, CI-friendly."
      />

      <section className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-24">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Install
          </h2>
          <div className="mt-4">
            <CodeBlock label="npm">{`npm install -g vantly-ugc-cli`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Quick start
          </h2>
          <div className="mt-4">
            <CodeBlock label="bash">{`# 1. Log in
vantly-ugc login

# 2. Pick an actor
vantly-ugc actor list

# 3. Generate a UGC video
vantly-ugc ugc "Stop scrolling. This tool changed everything for me." \\
  --actor sofia --style neon --duration 10 --sync

# 4. Add subtitles to any video
vantly-ugc subtitle ./video.mp4 --style hormozi --sync`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            The UGC pipeline
          </h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            Script → scene splitting → TTS voiceover → AI talking heads → AI B-roll →
            crossfade assembly → animated subtitles → background music → end screen CTA.
          </p>
          <div className="mt-4">
            <CodeBlock label="bash">{`# With B-roll cutaway scenes
vantly-ugc ugc "your script..." --actor sofia --broll --sync

# With product screenshots as B-roll
vantly-ugc ugc "your script..." --actor sofia --broll \\
  --broll-images ./dashboard.png,./calendar.png --sync

# AI-generated script from a product description
vantly-ugc ugc -g "A fitness tracker that monitors sleep quality" --actor naomi --sync`}</CodeBlock>
          </div>
        </div>

        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Prefer to drive it from an agent instead? See the{' '}
          <Link href="/mcp" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            MCP server
          </Link>
          , or call the{' '}
          <Link href="/ugc-video-api" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            HTTP API
          </Link>{' '}
          directly.
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
