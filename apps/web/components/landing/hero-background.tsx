'use client';

/**
 * Landing-page hero background: the react-bits "liquid ether" WebGL
 * canvas, tuned to the cryptix purple palette. Loaded client-only
 * (three.js touches the DOM directly) and kept fully non-interactive
 * so it never intercepts clicks meant for the header/CTA above it.
 */

import dynamic from 'next/dynamic';

const LiquidEther = dynamic(() => import('@/components/LiquidEther'), {
  ssr: false,
});

const LIQUID_COLORS = ['#4500E7', '#9162FF', '#CB3DFF'];

/**
 * imageUrl / overlayOpacity come from the 'home' row in static_pages (see
 * FIXED_SLUGS in lib/content/get-page.ts). When an admin hasn't set a
 * hero image, this renders exactly as before -- the animated LiquidEther
 * canvas with its original fixed gradient -- so the common case (no
 * override) is pixel-identical to pre-existing behavior. Setting an
 * image replaces the animation with that static image (the two aren't
 * meant to blend) and swaps the gradient for a flat
 * `rgba(0,0,0,opacity/100)` overlay, using the same formula as
 * PageHero's hero background in marketing-shell.tsx, so the opacity
 * slider in the admin's HeroMediaUploader means the same thing everywhere
 * it appears.
 */
export function HeroBackground({
  imageUrl,
  overlayOpacity,
}: {
  imageUrl?: string | null;
  overlayOpacity?: number | null;
} = {}) {
  if (imageUrl) {
    const clamped = Math.min(100, Math.max(0, overlayOpacity ?? 45));
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[900px] max-h-[140vh] overflow-hidden"
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${clamped / 100})` }} />
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[900px] max-h-[140vh] overflow-hidden"
    >
      <LiquidEther
        colors={LIQUID_COLORS}
        autoDemo
        autoSpeed={0.4}
        autoIntensity={2}
        noInteract
        style={{ width: '100%', height: '100%' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.55) 55%, #000000 100%)',
        }}
      />
    </div>
  );
}
