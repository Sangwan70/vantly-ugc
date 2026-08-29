// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useRef, useState } from 'react';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

const CLIPS: Array<{ src: string; label: string }> = [
  {
    src: 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/vnext/primitive-runs/7252a5f8-48a5-439b-9e79-33333333cccc/simple-selfie.mp4',
    label: 'Simple selfie — talking head',
  },
  {
    src: 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/c3354440-1d8d-4832-ab4d-01bbd07bb9eb/character-video-final.mp4',
    label: 'Character video',
  },
  {
    src: 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/d095fee4-2935-456f-83de-4c00681ac051/character-video-final.mp4',
    label: 'Character video',
  },
  {
    src: 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/ac468576-3cc2-4d05-ad21-d69a34141132/character-video-final.mp4',
    label: 'Character video',
  },
  {
    src: 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/brand-extracts/subtitle/120eaf6f-d2af-4f66-83e8-e62ec826de01/3f2c5f0a-61c6-45b0-a855-f2484b95d65d-subs/subtitled.mp4',
    label: 'Subtitled export',
  },
];

function ShowcaseTile({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '200px 0px',
    });
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
    <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--cryptix-surface)' }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        className="w-full object-cover"
        style={{ aspectRatio: '9 / 16' }}
      />
      <p className="px-4 py-3 text-xs" style={{ color: 'var(--cryptix-text-muted)' }}>
        {label}
      </p>
    </div>
  );
}

export default function ShowcasePage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Showcase"
        title="See what Vantly UGC produces"
        lede="Real renders from the pipeline — talking-head UGC, character video, and captioned exports."
      />

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {CLIPS.map((clip, i) => (
            <ShowcaseTile key={i} src={clip.src} label={clip.label} />
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
