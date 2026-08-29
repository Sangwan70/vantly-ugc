// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Vantly UGC brand mark.
 *
 * Cropped from the official Vantly-UGC logo (public/vantly-ugc-logo.png) —
 * see public/vantly-ugc-icon.png for the square, transparent source this
 * renders. Replaces the earlier vantly-ugc chevron mark.
 *
 * `color` is kept for call-site compatibility with the old component (some
 * call sites pass a color meant for a dark/light background) but, same as
 * before this rename, has no effect: the mark is a fixed-color raster image,
 * not a recolorable vector.
 */
interface VantlyLogoProps {
  size?: number;
  color?: string;
  className?: string;
}

export function VantlyLogo({
  size = 32,
  className,
}: VantlyLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- used at too many
    // one-off sizes across the app for next/image's fixed width/height to be
    // worth the ceremony for a small static icon.
    <img
      src="/vantly-ugc-icon.png"
      alt="Vantly UGC"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
