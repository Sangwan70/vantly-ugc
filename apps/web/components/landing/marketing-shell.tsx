'use client';

/**
 * Shared shell for every marketing/docs page under apps/web/app
 * (use-cases, pricing, developers, cli, mcp, sdk/*, docs/*, blog,
 * how-to, showcase, ai-tools, skill-center...).
 *
 * Wraps content in the same dark cryptix theme + LandingHeader +
 * LandingFooter as the root landing page, and mounts LoginProvider so
 * every page's CTA buttons and the header's "Start generating" button
 * open the same OTP login modal. Pages using this shell should NOT
 * also render their own <LoginProvider> / header / footer.
 */

import type { ReactNode } from 'react';

import { LandingHeader } from '@/components/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { LoginProvider } from '@/components/login-context';

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <LoginProvider>
      <div className="theme-cryptix relative min-h-screen overflow-x-hidden" style={{ background: 'var(--cryptix-bg)' }}>
        <div className="relative z-10">
          <LandingHeader />
          <main>{children}</main>
          <LandingFooter />
        </div>
      </div>
    </LoginProvider>
  );
}

/**
 * Reusable page-header block used at the top of most marketing pages:
 * an eyebrow label, an H1, and an optional lede paragraph. Optionally
 * takes an admin-configured background image or video (hero_image_url /
 * hero_video_url from the static_pages table) with a dark overlay whose
 * strength is hero_overlay_opacity (0-100, matches the DB column's
 * default of 45). When neither is set, renders exactly as before --
 * transparent, showing the page's own cryptix-bg background -- so pages
 * that have never had a hero image configured are pixel-identical to
 * pre-existing behavior. When both are set, the video takes priority
 * (matches HeroMediaUploader's admin-facing note).
 *
 * IMPORTANT: the overlay style here (`rgba(0,0,0,${opacity/100})`) is
 * deliberately the exact same formula used by HeroMediaUploader's live
 * preview in the admin UI -- keep them in sync. A prior, unrelated bug
 * in the content-builder's own image crop tool came from the admin
 * preview not matching the real page's overlay; don't reintroduce that
 * class of bug here.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  imageUrl,
  videoUrl,
  overlayOpacity = 45,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  imageUrl?: string | null;
  videoUrl?: string | null;
  overlayOpacity?: number;
}) {
  const hasMedia = Boolean(videoUrl || imageUrl);
  const clampedOpacity = Math.min(100, Math.max(0, overlayOpacity));

  return (
    <div className="relative w-full">
      {hasMedia ? (
        <div className="absolute inset-0 z-0 overflow-hidden">
          {videoUrl ? (
            <video
              className="h-full w-full object-cover"
              src={videoUrl}
              autoPlay
              muted
              loop
              playsInline
            />
          ) : (
            <img src={imageUrl ?? undefined} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${clampedOpacity / 100})` }} />
        </div>
      ) : null}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-20 text-center sm:pt-28">
        <p
          className="text-xs font-semibold uppercase tracking-[0.25em]"
          style={{ color: 'var(--cryptix-purple)' }}
        >
          {eyebrow}
        </p>
        <h1
          className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          {title}
        </h1>
        {lede ? (
          <p
            className="mx-auto mt-6 max-w-2xl text-base sm:text-lg"
            style={{ color: 'var(--cryptix-text-muted)' }}
          >
            {lede}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** Dark code block used across the developer docs pages. */
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
    >
      {label ? (
        <div
          className="border-b px-4 py-2 text-xs font-medium"
          style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'var(--cryptix-text-muted)' }}
        >
          {label}
        </div>
      ) : null}
      <pre
        className="overflow-x-auto px-5 py-4 text-sm leading-relaxed"
        style={{ background: 'var(--cryptix-surface-2)', color: 'var(--cryptix-text)' }}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}
