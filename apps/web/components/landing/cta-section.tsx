'use client';

import { Home2CTAButton } from '@/components/home2-cta-button';
import { getAppLoginUrl } from '@/lib/marketing';
import { CtaClipScatter } from '@/components/landing/cta-clip-scatter';

/**
 * primaryText / secondaryText come from a fixed marketing page's
 * cta_primary_text / cta_secondary_text columns (see FIXED_SLUGS in
 * lib/content/get-page.ts) -- an admin can override the button labels
 * per-page. Both actions link to the app host's real /login page rather
 * than opening a login modal here (see getAppLoginUrl's comment for why:
 * a session created by a modal on THIS host would be a cookie the app
 * host's middleware can never see) -- this site has no other CTA
 * destination configured for these fields (matching the schema, which
 * stores label text only, no target URL), so a distinct secondary label
 * reads as a lower-emphasis phrasing of the same action rather than a
 * link elsewhere.
 */
export function CtaSection({
  primaryText,
  secondaryText,
}: {
  primaryText?: string | null;
  secondaryText?: string | null;
}) {
  const loginUrl = getAppLoginUrl();

  return (
    <section className="relative mx-auto w-full max-w-4xl px-6 py-24 text-center">
      <div
        className="relative rounded-[32px] border px-8 py-16 sm:px-16"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 50% 0%, rgba(145,98,255,0.18) 0%, rgba(0,0,0,0) 60%), var(--cryptix-surface)',
        }}
      >
        <CtaClipScatter />
        <div className="relative z-10">
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
            <Home2CTAButton href={loginUrl} variant="dark" size="lg">
              {primaryText?.trim() || 'Start generating'}
            </Home2CTAButton>
            {secondaryText?.trim() ? (
              <a
                href={loginUrl}
                className="text-sm font-medium underline-offset-4 hover:underline"
                style={{ color: 'var(--cryptix-text-muted)' }}
              >
                {secondaryText}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
