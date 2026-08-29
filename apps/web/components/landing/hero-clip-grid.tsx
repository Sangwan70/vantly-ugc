'use client';

/**
 * Hero visual: a grid of small real generated-video clips that "zoom
 * out" into place on mount (each tile starts scaled up + faded, then
 * settles to its resting size on a stagger). Mirrors the live
 * agent-media.ai hero's clip carousel, using our own real R2-hosted
 * sample renders (same clips as Home2Flow / FeatureGrid).
 */

import { useEffect, useRef, useState } from 'react';

const CLIPS = [
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/vnext/primitive-runs/7252a5f8-48a5-439b-9e79-33333333cccc/simple-selfie.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/c3354440-1d8d-4832-ab4d-01bbd07bb9eb/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/d095fee4-2935-456f-83de-4c00681ac051/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/ac468576-3cc2-4d05-ad21-d69a34141132/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/brand-extracts/subtitle/120eaf6f-d2af-4f66-83e8-e62ec826de01/3f2c5f0a-61c6-45b0-a855-f2484b95d65d-subs/subtitled.mp4',
];

// Repeat + slightly reorder so the grid has 8 tiles without importing
// more clips than we actually have.
const TILES = [CLIPS[0], CLIPS[1], CLIPS[2], CLIPS[3], CLIPS[4], CLIPS[1], CLIPS[3], CLIPS[0]];

function ClipTile({ src, delayMs, tall }: { src: string; delayMs: number; tall?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), delayMs);
    const el = ref.current;
    el?.play().catch(() => {});
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <div
      className="overflow-hidden rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-all ease-out"
      style={{
        transitionDuration: '900ms',
        transform: settled ? 'scale(1)' : 'scale(1.55)',
        opacity: settled ? 1 : 0,
        gridRow: tall ? 'span 2' : undefined,
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={src}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        className="h-full w-full object-cover"
        style={{ aspectRatio: '9 / 16' }}
      />
    </div>
  );
}

export function HeroClipGrid() {
  return (
    <div
      className="pointer-events-none mx-auto mt-14 grid w-full max-w-5xl grid-cols-4 gap-3 px-6 sm:grid-cols-8 sm:gap-4"
      style={{
        maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
      }}
    >
      {TILES.map((src, i) => (
        <ClipTile key={i} src={src} delayMs={80 + i * 90} tall={i === 1 || i === 6} />
      ))}
    </div>
  );
}
