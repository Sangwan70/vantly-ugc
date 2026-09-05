// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { sanitizeStaticPageHtml } from '@/lib/content/sanitize-html';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/** Lists every post for the admin table (all statuses, newest first). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await adminClient()
    .from('blog_posts')
    .select('id, slug, title, status, published_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to list posts', details: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

/**
 * Creates a new post. slug is admin-supplied (auto-slugified client-side
 * from the title until touched, same UX as AutoGPT's BlogPostFormDialog)
 * but re-slugified and validated here too -- the client's slug is a
 * convenience, not the security boundary. content_html is ALWAYS run
 * through sanitizeStaticPageHtml() here, unconditionally, same reasoning
 * as /api/admin/content/[slug]'s PUT handler.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : title;
  const slug = slugify(rawSlug);
  if (!slug) return NextResponse.json({ error: 'slug could not be derived from title' }, { status: 400 });

  const status = typeof body.status === 'string' && VALID_STATUSES.has(body.status) ? body.status : 'draft';

  const row = {
    slug,
    title,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt.trim() : '',
    cover_image_url: typeof body.cover_image_url === 'string' ? body.cover_image_url.trim() || null : null,
    content_html: sanitizeStaticPageHtml(typeof body.content_html === 'string' ? body.content_html : ''),
    status,
    seo_description: typeof body.seo_description === 'string' ? body.seo_description.trim() || null : null,
    published_at: status === 'published' ? new Date().toISOString() : null,
    created_by: user.id,
  };

  const { data, error } = await adminClient().from('blog_posts').insert(row).select('*').single();
  if (error) {
    const status2 = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: 'Failed to create post', details: error.message }, { status: status2 });
  }
  return NextResponse.json({ success: true, post: data }, { status: 201 });
}
