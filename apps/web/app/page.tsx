// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Root route — the Vantly UGC marketing / landing page.
 *
 * Signed-in visitors never see this: middleware.ts redirects `/` to
 * `/dashboard` whenever a session exists (on every host, including
 * localhost). Signed-out visitors land here and can start the email-OTP
 * flow straight from the header or any of the CTA buttons on this page —
 * there is no separate "login" link or "signup" page, since one modal
 * (LoginModal, via LoginProvider/useLogin) handles both.
 */

import { LandingHeader } from '@/components/landing-header';
import { LoginProvider } from '@/components/login-context';
import { Home2Flow } from '@/components/home2-flow';
import { HeroBackground } from '@/components/landing/hero-background';
import { HeroSection } from '@/components/landing/hero-section';
import { StatsRow } from '@/components/landing/stats-row';
import { FeatureGrid } from '@/components/landing/feature-grid';
import { AiToolsRow } from '@/components/landing/ai-tools-row';
import { PricingCards } from '@/components/pricing-cards';
import { FaqSection } from '@/components/landing/faq-section';
import { CtaSection } from '@/components/landing/cta-section';
import { LandingFooter } from '@/components/landing/landing-footer';
import { getStaticPage } from '@/lib/content/get-page';

export default async function RootPage() {
  const page = await getStaticPage('home');

  return (
    <LoginProvider>
      <div className="theme-cryptix relative min-h-screen overflow-x-hidden">
        <HeroBackground imageUrl={page?.hero_image_url} overlayOpacity={page?.hero_overlay_opacity} />

        <div className="relative z-10">
          <LandingHeader />

          <main>
            <HeroSection title={page?.title} subtitle={page?.content_html} />
            <Home2Flow />
            <StatsRow />
            <FeatureGrid />
            <AiToolsRow />

            <section className="relative mx-auto w-full max-w-6xl px-6 py-24">
              <div className="mx-auto max-w-2xl text-center">
                <p
                  className="text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: 'var(--cryptix-purple)' }}
                >
                  Pricing
                </p>
                <h2
                  className="mt-4 text-3xl font-semibold sm:text-4xl"
                  style={{ color: 'var(--cryptix-text)' }}
                >
                  Simple, transparent pricing
                </h2>
                <p className="mt-4 text-base" style={{ color: 'var(--cryptix-text-muted)' }}>
                  Pick a plan, generate videos, upgrade or cancel anytime.
                </p>
              </div>
              <div className="mt-12">
                <PricingCards />
              </div>
            </section>

            <FaqSection />
            <CtaSection />
          </main>

          <LandingFooter />
        </div>
      </div>
    </LoginProvider>
  );
}
