// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import SubscribeForm from './subscribe-form';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getLandingPage(slug: string) {
  const { data } = await adminClient()
    .from('email_landing_pages')
    .select('slug, title, description, status')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getLandingPage(slug);
  return { title: page ? `${page.title} — Vantly UGC` : 'Sign up — Vantly UGC' };
}

/** Public opt-in page for an email_landing_pages row -- see the CRUD routes under app/api/admin/mailer/landing-pages and the public submit route app/api/mailer/newsletter/[slug]. */
export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getLandingPage(slug);
  if (!page || page.status !== 'active') notFound();

  return (
    <MarketingShell>
      <PageHero eyebrow="Sign up" title={page.title} />
      <section className="mx-auto w-full max-w-md px-6 pb-24">
        {page.description ? (
          <p className="mb-6 text-center text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>{page.description}</p>
        ) : null}
        <SubscribeForm slug={slug} />
      </section>
    </MarketingShell>
  );
}
