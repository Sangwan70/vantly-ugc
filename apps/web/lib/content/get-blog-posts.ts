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

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Published posts, newest first -- for the /blog listing page. */
export async function listPublishedBlogPosts(): Promise<BlogPostRow[]> {
  try {
    const { data, error } = await adminClient()
      .from('blog_posts')
      .select(LIST_COLUMNS)
      .eq('status', 'published')
      .order('published_at', { ascending: false });
    if (error || !data) return [];
    return data as BlogPostRow[];
  } catch {
    // A missing table (pre-migration) or any other read failure just
    // means "no posts yet" -- a CMS outage should never take down the
    // public blog listing.
    return [];
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
