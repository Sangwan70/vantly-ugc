// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Server-only helpers: read published blog_posts rows for the public
 * /blog listing and /blog/[slug] detail pages. Same convention as
 * lib/content/get-page.ts's getStaticPage -- reads via the service-role
 * client (RLS on blog_posts has no public policy, see the migration) and
 * explicitly filters status = 'published' here, since that filtering is
 * exactly what a public RLS policy would otherwise be responsible for.
 *
 * Never import into a 'use client' component.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

export type BlogPostStatus = 'draft' | 'published' | 'archived';

/** Shared between app/blog/page.tsx's initial server-rendered batch and
 * app/api/blog/posts/route.ts's "Load more" default, so both sides of the
 * pagination agree on page size without a magic number duplicated in two
 * files. 8 = two full rows at the /blog grid's 4-column desktop breakpoint. */
export const BLOG_LIST_PAGE_SIZE = 8;

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image_url: string | null;
  content_html: string;
  status: BlogPostStatus;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const LIST_COLUMNS = 'id, slug, title, excerpt, cover_image_url, content_html, status, seo_description, published_at, created_at, updated_at';

/** Lighter projection for the /blog listing grid, which never renders
 * content_html/seo_description/status -- fetching those repeatedly across
 * "Load more" pages just to discard them was pure waste, especially once
 * content_html (a full post body) is in the mix. */
const PREVIEW_COLUMNS = 'id, slug, title, excerpt, cover_image_url, published_at';

export interface BlogPostPreview {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image_url: string | null;
  published_at: string | null;
}

export interface BlogPostPage {
  posts: BlogPostPreview[];
  /** True when more published posts exist past this page's offset+limit -- drives the /blog "Load more" button. */
  hasMore: boolean;
}

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Published posts, newest first -- for the /blog listing page and its
 * "Load more" API route (app/api/blog/posts/route.ts).
 *
 * `limit` omitted (the only caller before pagination existed) fetches
 * every published post in one shot, unpaginated -- kept for
 * back-compat/simplicity rather than forcing every caller to pass a page
 * size. Passing `limit` switches to a proper range query and reports
 * `hasMore` via an exact count, so the UI knows whether to show/hide the
 * "Load more" button without a second round-trip.
 */
export async function listPublishedBlogPosts(opts?: { offset?: number; limit?: number }): Promise<BlogPostPage> {
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = opts?.limit;
  try {
    let query = adminClient()
      .from('blog_posts')
      .select(PREVIEW_COLUMNS, limit !== undefined ? { count: 'exact' } : undefined)
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (limit !== undefined) {
      query = query.range(offset, offset + limit - 1);
    }
    const { data, error, count } = await query;
    if (error || !data) return { posts: [], hasMore: false };
    const posts = data as BlogPostPreview[];
    const hasMore = limit !== undefined && typeof count === 'number' ? offset + posts.length < count : false;
    return { posts, hasMore };
  } catch {
    // A missing table (pre-migration) or any other read failure just
    // means "no posts yet" -- a CMS outage should never take down the
    // public blog listing.
    return { posts: [], hasMore: false };
  }
}

/** One published post by slug -- for /blog/[slug]. Returns null if the
 * slug doesn't exist OR isn't published (a draft/archived post 404s on
 * its public URL exactly like a missing one). */
export async function getPublishedBlogPost(slug: string): Promise<BlogPostRow | null> {
  try {
    const { data, error } = await adminClient()
      .from('blog_posts')
      .select(LIST_COLUMNS)
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return null;
    return data as BlogPostRow;
  } catch {
    return null;
  }
}
