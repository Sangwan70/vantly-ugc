// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import Link from 'next/link';
import type { Metadata } from 'next';

import { getStaticPage } from '@/lib/content/get-page';
import { renderContentVars } from '@/lib/content/render-vars';

/**
 * Privacy Policy — a self-hosted default.
 *
 * Same request-time env pattern as terms/page.tsx and the root layout: reads
 * process.env at request time (export const dynamic = 'force-dynamic') so
 * one Docker image shows the correct site URL for any environment without a
 * rebuild.
 *
 * This is boilerplate meant to get a self-hoster running, not legal advice —
 * whoever operates this instance is the data controller for it and should
 * have a lawyer review and adapt this (including for GDPR/CCPA if it
 * applies to them) before relying on it.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy Policy',
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

export default async function PrivacyPage() {
  const url = siteUrl();
  const contact = supportContact();
  const page = await getStaticPage('privacy');
  const customHtml = page?.content_html?.trim()
    ? renderContentVars(page.content_html, { site_url: url, support_contact: contact ?? '' })
    : null;

  return (
    <div className="min-h-screen bg-background text-text">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-text-muted transition-opacity hover:opacity-80">
          &larr; Back
        </Link>

        <h1 className="mt-8 text-3xl font-semibold">{page?.title || 'Privacy Policy'}</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated: fill in when you adapt this page.</p>

        {customHtml ? (
          <div
            className="prose-privacy mt-10 space-y-8 text-sm leading-relaxed text-text"
            dangerouslySetInnerHTML={{ __html: customHtml }}
          />
        ) : (
        <div className="prose-privacy mt-10 space-y-8 text-sm leading-relaxed text-text">
          <section>
            <p>
              This Privacy Policy describes what information is collected by the service running at{' '}
              <span className="font-medium">{url}</span> (the &ldquo;Service&rdquo;) and how it is used, for people
              who create an account or otherwise use it.
            </p>
            <p className="mt-3 text-text-muted">
              This page is a starting template, not legal advice. The operator of this instance is the data
              controller for information collected here and is responsible for reviewing and adapting this policy
              &mdash; including for any regulation that applies to them, such as GDPR or CCPA &mdash; before relying
              on it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">1. Information collected</h2>
            <p className="mt-2">The Service processes:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Account information: your email address, and profile details from any SSO provider you sign in with (for example a Google account, or a connected Vantly organization).</li>
              <li>Content you provide: prompts, reference images, character sheets, and other input used to generate video and image content.</li>
              <li>Generated output: the videos, images, and captions the Service creates for you, and metadata about generation jobs (status, timing, credit cost where billing is enabled).</li>
              <li>Connected-account tokens: credentials needed to publish to a social platform on your behalf via Vantly, once you choose to connect one.</li>
              <li>Basic operational data: request logs and error reports used to keep the Service running.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">2. How information is used</h2>
            <p className="mt-2">
              Information is used to operate your account, generate the content you request, publish content to
              accounts you&rsquo;ve connected (including on a schedule you configure), process billing where enabled,
              and maintain and improve the Service&rsquo;s reliability and security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">3. Where information is stored &amp; processed</h2>
            <p className="mt-2">
              Account and application data is stored in this instance&rsquo;s own database (Supabase-compatible
              Postgres). Generated media is stored in this instance&rsquo;s own object storage (Cloudflare R2 or a
              self-hosted S3-compatible store). Prompts, reference material, and generation requests are sent to the
              AI providers this instance is configured to use (for example OpenAI and Evolink) to produce output.
              Publishing requests are sent to Vantly and, in turn, to whichever social platform you connect. None of
              these are controlled by vantly-ugc the software project &mdash; they are the operator&rsquo;s own
              infrastructure and accounts, or the third-party providers the operator has configured.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">4. Sharing</h2>
            <p className="mt-2">
              Information is shared only as needed to provide the Service: with the AI providers used for
              generation, with Vantly and the social platforms you explicitly connect and choose to publish to, and
              with infrastructure providers (database, storage, email delivery) that host this instance. It is not
              sold, and it is not shared for third-party advertising.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">5. Your choices</h2>
            <p className="mt-2">
              You can disconnect a social account at any time from the integrations page. You can ask the operator to
              export or delete your account data; contact details are below. Deleting your account removes access to
              generated content going forward but does not retract content already published to a connected platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">6. Retention</h2>
            <p className="mt-2">
              Account data and generation history are kept for as long as your account is active, or as needed to
              operate the Service, unless the operator has configured a different retention period.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">7. Children</h2>
            <p className="mt-2">The Service is not directed at children and is not intended for use by anyone under the age of 16.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">8. Changes</h2>
            <p className="mt-2">
              The operator may update this Privacy Policy from time to time. Continued use of the Service after an
              update constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text">9. Contact</h2>
            <p className="mt-2">
              {contact
                ? <>Questions about this policy, or requests to access or delete your data, can be sent to <span className="font-medium">{contact}</span>.</>
                : 'The operator of this instance has not configured a support contact address for this page yet.'}
            </p>
          </section>
        </div>
        )}

        <div className="mt-12 text-sm text-text-muted">
          See also our <Link href="/terms" className="underline hover:text-text">Terms of Use</Link>.
        </div>
      </div>
    </div>
  );
}
