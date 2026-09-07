// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';
import { BlogGrid } from '@/components/landing/blog-grid';
import { getStaticPage } from '@/lib/content/get-page';
import { listPublishedBlogPosts, BLOG_LIST_PAGE_SIZE } from '@/lib/content/get-blog-posts';

export const metadata: Metadata = {
  title: 'Blog — Vantly UGC',
  description: 'Notes from the Vantly UGC team on building an agent-first UGC video pipeline.',
};

export default async function BlogPage() {
  const [page, firstPage] = await Promise.all([
    getStaticPage('blog'),
    listPublishedBlogPosts({ offset: 0, limit: BLOG_LIST_PAGE_SIZE }),
  ]);

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

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <BlogGrid
          initialPosts={firstPage.posts}
          initialHasMore={firstPage.hasMore}
          pageSize={BLOG_LIST_PAGE_SIZE}
        />
      </section>

      <CtaSection primaryText={page?.cta_primary_text} secondaryText={page?.cta_secondary_text} />
    </MarketingShell>
  );
}
