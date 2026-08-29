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

export function HeroBackground() {
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
