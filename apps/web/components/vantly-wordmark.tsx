// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Simple "Vantly" text wordmark — used wherever the app previously showed
 * the (unrelated, literally-spells-"Postiz") Postiz brand SVG from
 * postiz-logo.tsx. Vantly is a self-hosted fork of Postiz with no separate
 * public logo asset of its own, so this is a plain styled wordmark rather
 * than a fabricated logo.
 */

interface VantlyWordmarkProps {
  className?: string;
}

export function VantlyWordmark({ className = '' }: VantlyWordmarkProps) {
  return (
    <span
      role="img"
      aria-label="Vantly"
      className={`inline-flex items-center font-bold tracking-tight text-[#121212] ${className}`}
      style={{ fontSize: '1.5rem', lineHeight: 1 }}
    >
      Vantly
    </span>
  );
}
