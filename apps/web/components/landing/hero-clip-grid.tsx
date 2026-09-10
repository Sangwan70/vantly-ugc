'use client';

/**
 * Hero visual: a fan of real generated-video clips radiating from a
 * glowing anchor point in the palm of the hand graphic beneath the
 * headline.
 *
 * Builds on the anchor-and-rotate technique agent-media.ai's hero uses
 * (confirmed by reading its shipped CSS: every card sits at the same
 * `left`/`bottom` point and only `rotate` differs -- no motion at all on
 * their site, and their hero section and the section right below it are
 * the exact same width, edge to edge), but goes further in three ways:
 *
 *  1. Width: this fan breaks out of HeroSection's own (narrower)
 *     max-w-4xl text column and matches Home2Flow's max-w-6xl container
 *     instead -- the block directly below it on this page -- the same
 *     `relative left-1/2 w-screen -translate-x-1/2` + `mx-auto max-w-6xl
 *     px-6` shape Home2Flow itself uses, so the two blocks line up.
 *  2. Shape: six of the seven cards settle on a fixed-radius arc
 *     centered on the anchor -- a true semicircle, spanning from one
 *     side of the fan to the other, sized so the two outermost cards'
 *     *outer edges* (not just their center point) land right on the
 *     fan's own edge, matching the block below it -- rather than
 *     agent-media.ai's flat wedge. The seventh settles just above the
 *     anchor instead of on it: high enough to clear the glow and logo
 *     sitting there, so it reads as resting in the palm rather than
 *     covering what it's holding.
 *  3. Motion: every card flies outward from the anchor as it settles,
 *     and the reveal order follows travel distance -- the six arc
 *     cards (all the same distance out) animate in first, and the
 *     seventh, zero-distance card animates in last, so the fan reads
 *     as "the arc flies out to its full spread, then one last card
 *     simply emerges in the palm" rather than firing in a fixed
 *     left-to-right order unrelated to where each one ends up.
 *
 * Both the arc's radius (a fraction of the fan's own measured width)
 * and the resulting reveal order are only ever computed client-side
 * inside the mount effect below (never during the initial render), so
 * the server-rendered markup and the client's first paint still match
 * exactly -- the fan's children don't render at all until that first
 * client-only measurement + ordering pass lands.
 */

import { useEffect, useRef, useState } from 'react';
import { DEMO_CLIPS } from './demo-clips';

// Fixed per card: rotation angle and which clip it shows. Ordered
// widest-angle-first so later (more centered) tiles paint on top --
// the same read order a fanned hand of cards has: the most "face on"
// card sits frontmost, angled ones recede behind it. The last angle
// (0deg) belongs to the palm card -- see PALM_INDEX -- so it's always
// both the most centered *and* the topmost, resting on the logo. This
// stacking order is independent of the reveal order (see
// REVEAL_STAGGER_MS).
const ANGLES = [-82, 82, -49, 49, -16, 16, 0];
const PALM_INDEX = ANGLES.length - 1;
const CLIP_ORDER = [0, 2, 4, 1, 3, 0, 2].map((i) => DEMO_CLIPS[i % DEMO_CLIPS.length]);

// Half the tile's own width per breakpoint (matches TILE_CLASS below,
// which centers every tile on `left: 50%` via this same offset) --
// needed so the arc's radius can be solved for precisely: the two
// outermost cards' *outer edge*, not just their center point, should
// land right on the fan's own edge, matching the block below it.
const TILE_HALF_WIDTH_REM = { base: 3.2, sm: 4.4 };

// How far above the anchor the palm card (index PALM_INDEX, the only
// one that doesn't sit out on the arc) settles, per breakpoint --
// tall enough to clear the glow + logo sitting on the anchor beneath
// it, so its own bottom edge rests just above them instead of
// covering them.
const PALM_LIFT_REM = { base: 7.5, sm: 10.4 };

const REVEAL_BASE_MS = 90;
const REVEAL_STAGGER_MS = 130;

// Fixed tile height per breakpoint (matches TILE_CLASS below), used
// only to size the container tall enough that the farthest-traveling
// card never gets clipped.
const TILE_HEIGHT_REM = { base: 11.4, sm: 15.6 };
const REM_PX = 16;

const TILE_CLASS =
  'absolute bottom-0 w-[6.4rem] h-[11.4rem] left-[calc(50%-3.2rem)] ' +
  'sm:w-[8.8rem] sm:h-[15.6rem] sm:left-[calc(50%-4.4rem)] ' +
  'overflow-hidden rounded-xl border shadow-[0_16px_44px_rgba(0,0,0,0.55)] ' +
  'transition-[rotate,scale,translate,opacity] ease-out';

type TileLayout = { radiusPx: number; delayMs: number };

function FanTile({
  src,
  deg,
  z,
  target,
  reduceMotion,
}: {
  src: string;
  deg: number;
  z: number;
  target: TileLayout;
  reduceMotion: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), reduceMotion ? 0 : target.delayMs);
    ref.current?.play().catch(() => {});
    return () => clearTimeout(t);
  }, [target.delayMs, reduceMotion]);

  const active = show || reduceMotion;
  const radius = active ? target.radiusPx : 0;
  const rad = (deg * Math.PI) / 180;
  // deg=0 travels straight up; positive/negative deg lean the outward
  // travel right/left to match which way the card is rotated.
  const dxPx = Math.sin(rad) * radius;
  const dyPx = -Math.cos(rad) * radius;

  return (
    <div
      className={TILE_CLASS}
      style={{
        borderColor: 'rgba(255,255,255,0.14)',
        transitionDuration: '860ms',
        transitionDelay: reduceMotion ? '0ms' : `${target.delayMs}ms`,
        transformOrigin: '50% 100%',
        rotate: active ? `${deg}deg` : '0deg',
        scale: active ? '1' : '0.35',
        translate: `${dxPx}px ${dyPx}px`,
        opacity: active ? 1 : 0,
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  // null until the fan's real width is measured (and each card's arc
  // radius + farthest-first reveal order computed) on mount -- see the
  // file comment for why children wait on this instead of guessing.
  const [layout, setLayout] = useState<{
    height: number;
    tiles: TileLayout[];
    reduceMotion: boolean;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = el.getBoundingClientRect().width;
    const isSm = window.matchMedia('(min-width: 640px)').matches;
    const tileHeightPx = (isSm ? TILE_HEIGHT_REM.sm : TILE_HEIGHT_REM.base) * REM_PX;
    const tileHalfWidthPx = (isSm ? TILE_HALF_WIDTH_REM.sm : TILE_HALF_WIDTH_REM.base) * REM_PX;
    const palmLiftPx = (isSm ? PALM_LIFT_REM.sm : PALM_LIFT_REM.base) * REM_PX;

    // Solve for the radius that puts the widest arc card's *outer
    // edge* exactly on the fan's own edge. A rotated tile's bounding
    // box isn't just its own width -- at these steep angles the tile
    // is nearly on its side, so its farthest corner from the pivot is
    // dominated by its *height*, not half its width (h*sinTheta +
    // (w/2)*cosTheta, the standard rotated-rectangle corner distance).
    // Ignoring that ran the tile's long edge straight past the fan's
    // border -- the "half visible" clipping this replaces.
    const maxAngleRad = (Math.max(...ANGLES.map(Math.abs)) * Math.PI) / 180;
    const cornerReachPx =
      tileHeightPx * Math.sin(maxAngleRad) + tileHalfWidthPx * Math.cos(maxAngleRad);
    const arcRadiusPx = (width / 2 - cornerReachPx) / Math.sin(maxAngleRad);

    // Every card gets the fixed arc radius except the palm card, which
    // instead travels straight up by a fixed lift so it settles just
    // above the anchor -- clear of the glow/logo -- rather than right
    // on top of it.
    const travelPx = ANGLES.map((_, i) => (i === PALM_INDEX ? palmLiftPx : arcRadiusPx));
    // Rank purely by "is this the palm card or not" -- 0 for the palm
    // card, the shared arc radius for the rest -- so the six arc cards
    // (tied) keep their original array order via a stable sort, and
    // the palm card always sorts last, so it's always the one that
    // simply emerges after the arc has flown out.
    const rankKeys = ANGLES.map((_, i) => (i === PALM_INDEX ? 0 : arcRadiusPx));
    const rankByDistanceDesc = rankKeys
      .map((r, i) => i)
      .sort((a, b) => rankKeys[b] - rankKeys[a]);
    const tiles: TileLayout[] = travelPx.map(() => ({ radiusPx: 0, delayMs: 0 }));
    rankByDistanceDesc.forEach((originalIndex, rank) => {
      tiles[originalIndex] = {
        radiusPx: travelPx[originalIndex],
        delayMs: REVEAL_BASE_MS + rank * REVEAL_STAGGER_MS,
      };
    });

    // Tall enough that even an arc card straight up (deg=0 would be,
    // though that slot is now the palm card) still clears the
    // container with some breathing room -- plus a little extra at
    // the very bottom so the hand doesn't sit flush against the next
    // section.
    setLayout({ height: tileHeightPx + arcRadiusPx + 56, tiles, reduceMotion });
  }, []);

  return (
    <div className="relative left-1/2 w-screen -translate-x-1/2">
      <div
        ref={containerRef}
        className="pointer-events-none relative mx-auto mt-16 max-w-6xl px-6 sm:mt-20"
        style={{
          height: layout ? `${layout.height}px` : '18rem',
          maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
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

        {/* The hand the cards fan out of, holding the brand mark --
            the other half of the agent-media.ai reference (the fan
            technique was the first half, see the file comment). Uses
            the real hand photo dropped into public/hero-hand.png,
            positioned so its cupped-palm point (not the image's own
            corner) lands on the fan's shared anchor -- see the
            translate comment just below. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- one-off hero decoration, not worth next/image's fixed-size ceremony */}
        <img
          aria-hidden
          src="/hero-hand.png"
          alt=""
          className="absolute bottom-0 left-1/2 w-[16rem] sm:w-[22rem]"
          style={{
            zIndex: 1,
            translate: '-62% 64%',
            filter: 'drop-shadow(0 0 26px rgba(203,61,255,0.45)) drop-shadow(0 0 54px rgba(69,0,231,0.4))',
          }}
        />
        <div
          aria-hidden
          className="absolute bottom-[3.6rem] left-1/2 h-14 w-14 -translate-x-1/2 rounded-full blur-2xl sm:bottom-[5rem] sm:h-20 sm:w-20"
          style={{ zIndex: 2, background: 'var(--cryptix-purple-hot)', opacity: 0.9 }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand icon, same call as VantlyLogo */}
        <img
          aria-hidden
          src="/vantly-ugc-icon.png"
          alt=""
          className="absolute bottom-[4rem] left-1/2 h-10 w-10 -translate-x-1/2 sm:bottom-[5.6rem] sm:h-14 sm:w-14"
          style={{ zIndex: 3, filter: 'drop-shadow(0 0 16px rgba(203,61,255,0.85))' }}
        />

        {layout &&
          ANGLES.map((deg, i) => (
            <FanTile
              key={i}
              src={CLIP_ORDER[i]}
              deg={deg}
              z={i + 10}
              target={layout.tiles[i]}
              reduceMotion={layout.reduceMotion}
            />
          ))}
      </div>
    </div>
  );
}
