'use client';

// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * /blog listing grid + "Load more" button.
 *
 * Renders `initialPosts` (fetched server-side in app/blog/page.tsx, so the
 * first batch is in the HTML for a fast first paint and for crawlers) as a
 * 4-column grid, then fetches additional pages from
 * GET /api/blog/posts?offset=&limit= on click, appending to the same grid.
 * `initialPosts`/`initialHasMore` must be a client component's props (not
 * fetched here) because get-blog-posts.ts is server-only (service-role
 * client) and can't be imported into 'use client' code -- see that file's
 * own doc comment.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { BlogPostPreview } from '@/lib/content/get-blog-posts';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function BlogPostCard({ post }: { post: BlogPostPreview }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="flex h-full flex-col overflow-hidden rounded-2xl border transition-colors hover:border-white/20"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
    >
      {post.cover_image_url ? (
        <img src={post.cover_image_url} alt="" className="h-36 w-full object-cover" />
      ) : null}
      <div className="flex flex-1 flex-col px-5 py-5">
        <p
          className="text-xs font-medium uppercase tracking-[0.15em]"
          style={{ color: 'var(--cryptix-purple)' }}
        >
          {formatDate(post.published_at) || 'Vantly UGC Team'}
        </p>
        <h2 className="mt-2 text-base font-semibold leading-snug" style={{ color: 'var(--cryptix-text)' }}>
          {post.title}
        </h2>
        {post.excerpt ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
            {post.excerpt}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function BlogGrid({
  initialPosts,
  initialHasMore,
  pageSize,
}: {
  initialPosts: BlogPostPreview[];
  initialHasMore: boolean;
  pageSize: number;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/blog/posts?offset=${posts.length}&limit=${pageSize}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const page = (await res.json()) as { posts: BlogPostPreview[]; hasMore: boolean };
      setPosts((prev) => [...prev, ...page.posts]);
      setHasMore(page.hasMore);
    } catch {
      setError('Could not load more posts — please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (posts.length === 0) {
    return (
      <p className="text-center text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
        No posts published yet — check back soon.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {posts.map((post) => (
          <BlogPostCard key={post.id} post={post} />
        ))}
      </div>

      {error ? (
        <p className="mt-6 text-center text-sm" style={{ color: '#F87171' }}>
          {error}
        </p>
      ) : null}

      {hasMore ? (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors hover:border-white/20 disabled:opacity-60"
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'var(--cryptix-text)', background: 'var(--cryptix-surface)' }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </>
  );
}
