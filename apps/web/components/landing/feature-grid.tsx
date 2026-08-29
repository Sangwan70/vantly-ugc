// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Landing page — feature grid.
 *
 * Six cards mirroring the old agent-media.ai marketing page's features
 * section (same six ideas, copy rewritten for Vantly UGC). Each card
 * previews a real generated clip rather than a static screenshot — reusing
 * the same public R2-hosted sample outputs already referenced by
 * components/home2-flow.tsx, since those are real product output already
 * safe to show (no placeholder/stock assets needed).
 */

import { useEffect, useRef, useState } from 'react';

const SAMPLE_CLIPS = [
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/vnext/primitive-runs/7252a5f8-48a5-439b-9e79-33333333cccc/simple-selfie.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/c3354440-1d8d-4832-ab4d-01bbd07bb9eb/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/d095fee4-2935-456f-83de-4c00681ac051/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/ac468576-3cc2-4d05-ad21-d69a34141132/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/brand-extracts/subtitle/120eaf6f-d2af-4f66-83e8-e62ec826de01/3f2c5f0a-61c6-45b0-a855-f2484b95d65d-subs/subtitled.mp4',
];

const FEATURES: Array<{ title: string; desc: string }> = [
  {
    title: 'Support any agent',
    desc: 'Use Vantly UGC from the AI agents and tools your team already works with.',
  },
  {
    title: 'Agentic CLI to create UGC',
    desc: 'Launch a UGC render with one command and receive a ready-to-preview video.',
  },
  {
    title: 'Connect via MCP, CLI, or API',
    desc: 'Run Vantly UGC from your AI agent, terminal, or product workflow.',
  },
  {
    title: 'Create videos from our web app agent',
    desc: 'Describe the video in chat, refine the result, and export it directly from the Vantly UGC web app.',
  },
  {
    title: 'UGC, picture in picture, show your phone, add B-roll',
    desc: 'Mix creator footage, product screens, and supporting visuals in one flexible workflow.',
  },
  {
    title: 'Production-grade 1080p videos',
    desc: 'Export clean 1080p vertical videos with captions, audio, and social-ready framing.',
  },
];

function FeatureVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '200px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) {
      if (!el.src) {
        el.src = src;
        el.load();
      }
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [visible, src]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      className="h-full w-full object-cover"
    />
  );
}

export function FeatureGrid() {
  return (
    <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2
          className="text-3xl font-bold tracking-tight sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          Everything the pipeline needs, none of the busywork
        </h2>
        <p className="mt-4 text-base" style={{ color: 'var(--cryptix-text-muted)' }}>
          One tool, called however your workflow already works.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.title}
            className="overflow-hidden rounded-2xl"
            style={{
              backgroundColor: 'var(--cryptix-surface)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            <div className="aspect-[16/10] w-full bg-black">
              <FeatureVideo src={SAMPLE_CLIPS[i % SAMPLE_CLIPS.length]} />
            </div>
            <div className="p-6">
              <h3
                className="text-base font-semibold"
                style={{ color: 'var(--cryptix-text)' }}
              >
                {feature.title}
              </h3>
              <p
                className="mt-2 text-sm leading-6"
                style={{ color: 'var(--cryptix-text-muted)' }}
              >
                {feature.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
