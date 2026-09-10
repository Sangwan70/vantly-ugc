'use client';

/**
 * Hero visual: a fan of real generated-video clips radiating from a
 * glowing anchor point beneath the headline.
 *
 * This mirrors the actual technique agent-media.ai's hero uses,
 * confirmed by reading its shipped CSS in a live browser session: every
 * card in their fan sits at the *exact same* `left`/`bottom` anchor and
 * only its `rotate` differs (no per-card transform, no hover/scroll/
 * mousemove listener moves them) -- the "cards fanning out of the hand"
 * look is a static layout, not motion, on their site. We reuse that same
 * anchor-and-rotate trick here, but add a real pop-out entrance on mount
 * (theirs has none -- it renders straight into its resting fan), so this
 * version visibly fans out of the glow on page load, which is the part
 * that was actually asked for.
 */

import { useEffect, useRef, useState } from 'react';
import { DEMO_CLIPS } from './demo-clips';

// Widest-angle tiles listed first so later (more centered) tiles paint
// on top -- the same read order a fanned hand of cards has: the most
// "face on" card sits frontmost, angled ones recede behind it.
const ANGLES = [-30, 30, -20, 20, -11, 11, 0];
const CLIP_ORDER = [0, 2, 4, 1, 3, 0, 2].map((i) => DEMO_CLIPS[i % DEMO_CLIPS.length]);

const TILE_CLASS =
  'absolute bottom-0 w-[6.4rem] h-[11.4rem] left-[calc(50%-3.2rem)] ' +
  'sm:w-[8.8rem] sm:h-[15.6rem] sm:left-[calc(50%-4.4rem)] ' +
  'overflow-hidden rounded-xl border shadow-[0_16px_44px_rgba(0,0,0,0.55)] ' +
  'transition-[rotate,scale,opacity] ease-out';

function FanTile({ src, deg, delayMs, z }: { src: string; deg: number; delayMs: number; z: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [settled, setSettled] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const t = setTimeout(() => setSettled(true), delayMs);
    ref.current?.play().catch(() => {});
    return () => clearTimeout(t);
  }, [delayMs]);

  const show = settled || reduceMotion;

  return (
    <div
      className={TILE_CLASS}
      style={{
        borderColor: 'rgba(255,255,255,0.14)',
        transitionDuration: '820ms',
        transitionDelay: reduceMotion ? '0ms' : `${delayMs}ms`,
        transformOrigin: '50% 100%',
        rotate: show ? `${deg}deg` : '0deg',
        scale: show ? '1' : '0.35',
        opacity: show ? 1 : 0,
        zIndex: z,
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
      />
    </div>
  );
}

export function HeroClipGrid() {
  return (
    <div
      className="pointer-events-none relative mx-auto mt-16 h-[13rem] w-full max-w-md sm:mt-20 sm:h-[19rem] sm:max-w-lg"
      style={{
        maskImage: 'linear-gradient(to bottom, black 78%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 78%, transparent 100%)',
      }}
    >
      <div
        aria-hidden
        className="absolute bottom-0 left-1/2 h-32 w-32 -translate-x-1/2 translate-y-6 rounded-full blur-[56px] sm:h-44 sm:w-44"
        style={{ background: 'var(--cryptix-purple-hot)', opacity: 0.45 }}
      />
      <div
        aria-hidden
        className="absolute bottom-0 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full blur-3xl sm:h-32 sm:w-32"
        style={{ background: 'var(--cryptix-purple-deep)', opacity: 0.55 }}
      />
      {ANGLES.map((deg, i) => (
        <FanTile key={i} src={CLIP_ORDER[i]} deg={deg} delayMs={120 + i * 90} z={i} />
      ))}
    </div>
  );
}
