// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { getStaticPage } from '@/lib/content/get-page';
import { renderContentVars } from '@/lib/content/render-vars';

export const metadata: Metadata = {
  title: 'Contact — Vantly UGC',
  description: 'Get in touch with the team running this Vantly UGC instance.',
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

// No @tailwindcss/typography plugin in this repo -- style nested elements
// directly via Tailwind v4 arbitrary-descendant selectors, same
// convention used by the admin builder's InlineTextEditor.
const RICH_TEXT_CLASSES =
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold ' +
  '[&_a]:underline [&_p]:my-3 [&_h1]:my-4 [&_h2]:my-4 [&_h3]:my-3';

export default async function ContactPage() {
  const url = siteUrl();
  const contact = supportContact();
  const page = await getStaticPage('contact');
  const customHtml = page?.content_html?.trim()
    ? renderContentVars(page.content_html, { site_url: url, support_contact: contact ?? '' })
    : null;

  return (
    <MarketingShell>
      <PageHero eyebrow="Contact" title={page?.title || 'Get in touch'} />

      <section className="mx-auto w-full max-w-2xl px-6 pb-24 text-center">
        {customHtml ? (
          <div
            className={`text-left text-sm leading-relaxed ${RICH_TEXT_CLASSES}`}
            style={{ color: 'var(--cryptix-text)' }}
            dangerouslySetInnerHTML={{ __html: customHtml }}
          />
        ) : (
          <p className="text-base" style={{ color: 'var(--cryptix-text-muted)' }}>
            {contact
              ? <>Reach us at <span className="font-medium" style={{ color: 'var(--cryptix-text)' }}>{contact}</span>.</>
              : 'The operator of this instance has not configured a support contact address for this page yet.'}
          </p>
        )}
      </section>
    </MarketingShell>
  );
}
