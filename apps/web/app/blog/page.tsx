// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';
import { getStaticPage } from '@/lib/content/get-page';
import { listPublishedBlogPosts } from '@/lib/content/get-blog-posts';

export const metadata: Metadata = {
  title: 'Blog — Vantly UGC',
  description: 'Notes from the Vantly UGC team on building an agent-first UGC video pipeline.',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BlogPage() {
  const [page, posts] = await Promise.all([getStaticPage('blog'), listPublishedBlogPosts()]);

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Blog"
        title={page?.title || 'Notes from the team'}
        lede={page?.content_html?.trim() || 'Short write-ups on how the pipeline is built and why.'}
        imageUrl={page?.hero_image_url}
        videoUrl={page?.hero_video_url}
        overlayOpacity={page?.hero_overlay_opacity ?? 45}
      />

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        {posts.length === 0 ? (
          <p className="text-center text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            No posts published yet — check back soon.
          </p>
        ) : (
          <div className="space-y-5">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="block overflow-hidden rounded-2xl border transition-colors hover:border-white/20"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
              >
                {post.cover_image_url ? (
                  <img src={post.cover_image_url} alt="" className="h-40 w-full object-cover" />
                ) : null}
                <div className="px-6 py-6">
                  <p
                    className="text-xs font-medium uppercase tracking-[0.15em]"
                    style={{ color: 'var(--cryptix-purple)' }}
                  >
                    {formatDate(post.published_at) || 'Vantly UGC Team'}
                  </p>
                  <h2 className="mt-2 text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                    {post.title}
                  </h2>
                  {post.excerpt ? (
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                      {post.excerpt}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CtaSection primaryText={page?.cta_primary_text} secondaryText={page?.cta_secondary_text} />
    </MarketingShell>
  );
}
