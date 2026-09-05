// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { MarketingShell } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';
import { getPublishedBlogPost } from '@/lib/content/get-blog-posts';

// No @tailwindcss/typography plugin in this repo -- style nested elements
// directly via Tailwind v4 arbitrary-descendant selectors, same
// convention used by the admin builder's InlineTextEditor and /contact.
const RICH_TEXT_CLASSES =
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:text-base [&_h4]:font-semibold ' +
  '[&_a]:underline [&_p]:my-3 [&_h2]:my-5 [&_h3]:my-4 [&_h4]:my-3 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-4 ' +
  '[&_img]:my-4 [&_img]:rounded-xl [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/40 [&_pre]:p-3';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) return { title: 'Post not found — Vantly UGC' };
  return {
    title: `${post.title} — Vantly UGC Blog`,
    description: post.seo_description || post.excerpt || undefined,
  };
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) notFound();

  return (
    <MarketingShell>
      <article className="mx-auto w-full max-w-2xl px-6 pb-24 pt-20 sm:pt-28">
        <Link href="/blog" className="text-sm transition-opacity hover:opacity-80" style={{ color: 'var(--cryptix-text-muted)' }}>
          &larr; Back to blog
        </Link>

        <p className="mt-6 text-xs font-medium uppercase tracking-[0.15em]" style={{ color: 'var(--cryptix-purple)' }}>
          {formatDate(post.published_at) || 'Vantly UGC Team'}
        </p>
        <h1
          className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          {post.title}
        </h1>
        {post.excerpt ? (
          <p className="mt-4 text-base" style={{ color: 'var(--cryptix-text-muted)' }}>{post.excerpt}</p>
        ) : null}

        {post.cover_image_url ? (
          <img src={post.cover_image_url} alt="" className="mt-8 h-auto w-full rounded-2xl object-cover" />
        ) : null}

        <div
          className={`mt-8 text-sm leading-relaxed ${RICH_TEXT_CLASSES}`}
          style={{ color: 'var(--cryptix-text)' }}
          dangerouslySetInnerHTML={{ __html: post.content_html }}
        />
      </article>

      <CtaSection />
    </MarketingShell>
  );
}
