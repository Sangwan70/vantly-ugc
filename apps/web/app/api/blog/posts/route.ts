// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/blog/posts?offset=&limit= -- public, unauthenticated pagination
 * for the /blog listing grid's "Load more" button. Deliberately outside
 * every middleware.ts auth/subscription gate (not under any of
 * AUTH_NO_SUB_ROUTES/SUBSCRIPTION_PREFIXES/APP_PREFIXES) -- this is
 * marketing content, same trust level as the /blog page itself.
 *
 * Thin wrapper around listPublishedBlogPosts() (lib/content/get-blog-posts.ts,
 * server-only / service-role) so the client-side "Load more" button
 * (components/landing/blog-grid.tsx) has something to fetch from -- the
 * initial page load still reads Supabase directly server-side in
 * app/blog/page.tsx for a fast first paint / working SEO crawl.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listPublishedBlogPosts, BLOG_LIST_PAGE_SIZE } from '@/lib/content/get-blog-posts';

const DEFAULT_LIMIT = BLOG_LIST_PAGE_SIZE;
const MAX_LIMIT = 24;

export async function GET(req: NextRequest) {
  const rawOffset = Number(req.nextUrl.searchParams.get('offset'));
  const rawLimit = Number(req.nextUrl.searchParams.get('limit'));

  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const page = await listPublishedBlogPosts({ offset, limit });
  return NextResponse.json(page);
}
