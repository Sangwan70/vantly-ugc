'use client';

import type { MouseEvent } from 'react';

import { Home2CTAButton } from '@/components/home2-cta-button';
import { useLogin } from '@/components/login-context';

/**
 * primaryText / secondaryText come from a fixed marketing page's
 * cta_primary_text / cta_secondary_text columns (see FIXED_SLUGS in
 * lib/content/get-page.ts) -- an admin can override the button labels
 * per-page. Both actions still open the same login modal: this site has
 * no other CTA destination configured for these fields (matching the
 * schema, which stores label text only, no target URL), so a distinct
 * secondary label reads as a lower-emphasis phrasing of the same action
 * rather than a link elsewhere.
 */
export function CtaSection({
  primaryText,
  secondaryText,
}: {
  primaryText?: string | null;
  secondaryText?: string | null;
}) {
  const { openLogin } = useLogin();

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openLogin();
  };

  return (
    <section className="relative mx-auto w-full max-w-4xl px-6 py-24 text-center">
      <div
        className="rounded-[32px] border px-8 py-16 sm:px-16"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 50% 0%, rgba(145,98,255,0.18) 0%, rgba(0,0,0,0) 60%), var(--cryptix-surface)',
        }}
      >
        <h2
          className="text-3xl font-semibold sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          The developer-first AI UGC video platform
        </h2>
        <p
          className="mx-auto mt-4 max-w-xl text-base"
          style={{ color: 'var(--cryptix-text-muted)' }}
        >
          Create production-ready UGC videos from AI agents, CLI, MCP, API,
          or the web app.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <div onClick={handleClick}>
            <Home2CTAButton href="#" variant="dark" size="lg">
              {primaryText?.trim() || 'Start generating'}
            </Home2CTAButton>
          </div>
          {secondaryText?.trim() ? (
            <button
              type="button"
              onClick={openLogin}
              className="text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: 'var(--cryptix-text-muted)' }}
            >
              {secondaryText}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
