'use client';

/**
 * Decoration for the bottom "Start generating" CTA card: small real
 * generated-video clips pinned at random points along the card's own
 * border, each at its own random tilt -- like photos scattered and
 * half-clipped to the edge of the card, rather than the continuous
 * auto-scrolling ticker this used to be (replaced per explicit
 * feedback: no scrolling here, static clips at random border positions
 * and angles instead).
 *
 * Each tile's exact position-along-the-edge / tilt / perpendicular
 * offset is randomized once, client-side, inside the mount effect below
 * -- never during the initial render -- so the server-rendered markup
 * and the client's first paint still match exactly; only the one-time
 * settle-in transition afterward reveals the randomized placement.
 */

import { useEffect, useRef, useState } from 'react';
import { DEMO_CLIPS } from './demo-clips';

type Side = 'top' | 'right' | 'bottom' | 'left';

// Base anchor points around the card's own border -- percentage along
// that side. Weighted toward the long top/bottom edges since the card
// itself is wide and short.
const SPOTS: Array<{ side: Side; pct: number }> = [
  { side: 'top', pct: 12 },
  { side: 'top', pct: 50 },
  { side: 'top', pct: 88 },
  { side: 'right', pct: 50 },
  { side: 'bottom', pct: 18 },
  { side: 'bottom', pct: 50 },
  { side: 'bottom', pct: 82 },
  { side: 'left', pct: 50 },
];

const CLIP_ORDER = [0, 2, 4, 1, 3, 0, 2, 4].map((i) => DEMO_CLIPS[i % DEMO_CLIPS.length]);

function ScatterTile({
  src,
  side,
  basePct,
  delayMs,
}: {
  src: string;
  side: Side;
  basePct: number;
  delayMs: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [show, setShow] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Randomized once per mount, client-side only -- see the file comment.
  const [jitter, setJitter] = useState({ pct: 0, deg: 0, perpPx: 0 });

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduceMotion(reduced);
    setJitter({
      pct: (Math.random() - 0.5) * 14, // +/-7% along the edge
      deg: (Math.random() - 0.5) * 40, // +/-20deg tilt
      perpPx: (Math.random() - 0.5) * 24, // +/-12px in/out of the border
    });
    const t = setTimeout(() => setShow(true), reduced ? 0 : delayMs);
    ref.current?.play().catch(() => {});
    return () => clearTimeout(t);
  }, [delayMs]);

  const active = show || reduceMotion;
  const pct = Math.min(94, Math.max(6, basePct + (active ? jitter.pct : 0)));
  const perp = active ? jitter.perpPx : 0;

  const posStyle: { top?: string | number; left?: string | number } = {};
  let translate: string;
  if (side === 'top' || side === 'bottom') {
    posStyle.left = `${pct}%`;
    posStyle.top = side === 'top' ? 0 : '100%';
    translate = `-50% calc(-50% + ${perp}px)`;
  } else {
    posStyle.top = `${pct}%`;
    posStyle.left = side === 'left' ? 0 : '100%';
    translate = `calc(-50% + ${perp}px) -50%`;
  }

  return (
    <div
      className="absolute h-[7rem] w-[4.5rem] overflow-hidden rounded-lg border shadow-[0_10px_28px_rgba(0,0,0,0.55)] transition-[rotate,scale,opacity] sm:h-[10rem] sm:w-[6rem]"
      style={{
        ...posStyle,
        translate,
        borderColor: 'rgba(255,255,255,0.16)',
        transitionDuration: '700ms',
        transitionDelay: reduceMotion ? '0ms' : `${delayMs}ms`,
        rotate: `${active ? jitter.deg : 0}deg`,
        scale: active ? '1' : '0.5',
        opacity: active ? 1 : 0,
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
        preload="none"
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export function CtaClipScatter() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {SPOTS.map((spot, i) => (
        <ScatterTile key={i} side={spot.side} basePct={spot.pct} src={CLIP_ORDER[i]} delayMs={90 + i * 80} />
      ))}
    </div>
  );
}
