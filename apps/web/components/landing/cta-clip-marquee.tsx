'use client';

/**
 * Ambient motion behind the bottom "Start generating" CTA card: two rows
 * of small real generated-video clips, each row auto-scrolling
 * continuously in an opposite direction and fading out at both edges.
 *
 * This is the *other* animation style spotted on agent-media.ai's own
 * landing page (a JS-updated `translateY` ticker further down their
 * page, confirmed by sampling its transform over time in a live
 * session) -- reimplemented here with the project's own existing
 * `.animate-marquee` keyframe (see globals.css, already used by
 * video-carousel.tsx) rather than a JS animation loop, since a doubled
 * track + CSS `translateX` gets the identical seamless-loop look with no
 * per-frame JS running on the landing page.
 */

import { DEMO_CLIPS } from './demo-clips';

const ROW_A = [...DEMO_CLIPS, ...DEMO_CLIPS];
const ROW_B = [...[...DEMO_CLIPS].reverse(), ...[...DEMO_CLIPS].reverse()];

function MarqueeRow({ items, reverse }: { items: readonly string[]; reverse?: boolean }) {
  return (
    <div
      className="flex w-max flex-shrink-0 gap-3 animate-marquee"
      style={{ animationDirection: reverse ? 'reverse' : 'normal', animationDuration: '32s' }}
    >
      {items.map((src, i) => (
        <div
          key={i}
          className="h-14 w-9 flex-shrink-0 overflow-hidden rounded-lg border sm:h-20 sm:w-12"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={src}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

export function CtaClipMarquee() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-6 z-0 opacity-45 sm:top-8"
    >
      <div className="relative left-1/2 w-screen -translate-x-1/2">
        <div
          className="flex flex-col gap-3"
          style={{
            maskImage: 'linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)',
          }}
        >
          <MarqueeRow items={ROW_A} />
          <MarqueeRow items={ROW_B} reverse />
        </div>
      </div>
    </div>
  );
}
