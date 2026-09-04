// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import Link from 'next/link';
import type { Metadata } from 'next';

import { getStaticPage } from '@/lib/content/get-page';
import { renderContentVars } from '@/lib/content/render-vars';

/**
 * Terms of Use — a self-hosted default.
 *
 * Read at REQUEST time (not baked in at build time) so one Docker image can
 * show the correct site URL for whichever environment it's running in — same
 * `export const dynamic = 'force-dynamic'` + request-time `process.env` read
 * used by the root layout (see app/layout.tsx) and for the same reason.
 *
 * This is boilerplate meant to get a self-hoster running, not legal advice —
 * whoever operates this instance should have a lawyer review and adapt it for
 * their jurisdiction, business entity, and actual practices before relying on
 * it, and should keep the "Last updated" date current when they do.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Terms of Use',
};

function siteUrl(): string {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const port = process.env.WEB_PORT?.trim() || '3005';
  return `http://localhost:${port}`;
}

function supportContact(): string | null {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return email ? email : null;
}

export default async function TermsPage() {
  const url = siteUrl();
  const contact = supportContact();
  const page = await getStaticPage('terms');
  const customHtml = page?.content_html?.trim()
    ? renderContentVars(page.content_html, { site_url: url, support_contact: contact ?? '' })
    : null;

  return (
    <div className="min-h-screen bg-background text-text">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-text-muted transition-opacity hover:opacity-80">
          &larr; Back
        </Link>

        <h1 className="mt-8 text-3xl font-semibold">Terms of Use</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated: fill in when you adapt this page.</p>

        {customHtml ? (
          <div
            className="prose-terms mt-10 space-y-8 text-sm leading-relaxed text-text"
            dangerouslySetInnerHTML={{ __html: customHtml }}
          />
        ) : (
        <div className="prose-terms mt-10 space-y-8 text-sm leading-relaxed text-text">
          <section>
            <p>
              These Terms of Use (&ldquo;Terms&rdquo;) govern access to and use of the service running at{' '}
              <span className="font-medium">{url}</span> (the &ldquo;Service&rdquo;), an instance of vantly-ugc,
              an agent-native AI UGC video generation platform. By creating an account or otherwise using the
              Service, you agree to these Terms. If you do not agree, do not use the Service.
            </p>
            <p className="mt-3 text-text-muted">
              This page is a starting template, not legal advice. The operator of this instance is responsible for
              reviewing and adapting it &mdash; including their legal name, jurisdiction, and contact details &mdash;
              before relying on it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">1. The Service</h2>
            <p className="mt-2">
              The Service lets you generate AI video and image content (character sheets, storyboards, UGC-style
              video) from prompts and reference material you provide, and optionally auto-publish the results to
              connected social accounts through a self-hosted Vantly integration. Generation is performed by
              third-party AI providers configured by the operator (for example OpenAI and Evolink); publishing is
              performed by the third-party platforms you connect to (for example X, TikTok, Instagram, or LinkedIn,
              via Vantly).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">2. Accounts</h2>
            <p className="mt-2">
              You need an account to use most of the Service, created via email sign-in or a supported SSO provider.
              You are responsible for the activity that happens under your account and for keeping your access
              credentials secure. Let the operator know promptly if you suspect unauthorized use.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">3. AI-generated content &amp; your responsibility</h2>
            <p className="mt-2">
              Content produced by the Service is machine-generated. It may occasionally be inaccurate, off-brand, or
              otherwise unexpected even with moderation in place, including when produced automatically by a
              recurring schedule you configure. You are solely responsible for reviewing generated content before it
              is published or otherwise used, and for everything posted to your connected social accounts &mdash;
              including content published automatically by a schedule you set up. Do not use the Service to generate
              content that is unlawful, infringing, defamatory, or that impersonates a real person without their
              consent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">4. Connected social &amp; third-party accounts</h2>
            <p className="mt-2">
              Connecting a social account (directly or via Vantly) authorizes the Service to publish content to it on
              your behalf, either on demand or on a schedule you create. You can disconnect an account at any time
              from the integrations page; disconnecting stops future publishing but does not retract content already
              posted. The Service is not responsible for the availability, terms, or policies of third-party
              platforms it publishes to.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">5. Acceptable use</h2>
            <p className="mt-2">
              Don&rsquo;t use the Service to violate applicable law, infringe someone else&rsquo;s rights, distribute
              malware, attempt to disrupt or gain unauthorized access to the Service or its infrastructure, or resell
              access without the operator&rsquo;s agreement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">6. Billing</h2>
            <p className="mt-2">
              Where billing is enabled on this instance, purchases of credits or subscriptions are handled as
              described at the point of purchase. Where billing is disabled (the default for self-hosted instances),
              you use your own provider API keys and there is no credit ledger or payment processed by the Service
              itself.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">7. Disclaimers &amp; limitation of liability</h2>
            <p className="mt-2">
              The Service is provided &ldquo;as is&rdquo; without warranties of any kind, to the extent permitted by
              law. To the fullest extent permitted by applicable law, the operator will not be liable for indirect,
              incidental, or consequential damages arising from your use of the Service, including from
              AI-generated content published to your accounts.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">8. Changes</h2>
            <p className="mt-2">
              The operator may update these Terms from time to time. Continued use of the Service after an update
              constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">9. Contact</h2>
            <p className="mt-2">
              {contact
                ? <>Questions about these Terms can be sent to <span className="font-medium">{contact}</span>.</>
                : 'The operator of this instance has not configured a support contact address for this page yet.'}
            </p>
          </section>
        </div>
        )}

        <div className="mt-12 text-sm text-text-muted">
          See also our <Link href="/privacy" className="underline hover:text-text">Privacy policy</Link>.
        </div>
      </div>
    </div>
  );
}
