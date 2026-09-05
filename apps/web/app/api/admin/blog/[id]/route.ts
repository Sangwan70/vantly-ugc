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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await adminClient().from('blog_posts').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post: data });
}

/**
 * Full update. published_at is set the first time a post's status
 * becomes 'published' and preserved after that (moving back to draft or
 * archived doesn't erase "when this was first published"), same as most
 * CMSes' semantics -- and matches AutoGPT's own publishedAt handling.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: existing, error: fetchError } = await adminClient()
    .from('blog_posts')
    .select('published_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
  const published_at = status === 'published' ? (existing.published_at ?? new Date().toISOString()) : existing.published_at;

  const row = {
    slug,
    title,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt.trim() : '',
    cover_image_url: typeof body.cover_image_url === 'string' ? body.cover_image_url.trim() || null : null,
    content_html: sanitizeStaticPageHtml(typeof body.content_html === 'string' ? body.content_html : ''),
    status,
    seo_description: typeof body.seo_description === 'string' ? body.seo_description.trim() || null : null,
    published_at,
  };

  const { data, error } = await adminClient().from('blog_posts').update(row).eq('id', id).select('*').single();
  if (error) {
    const status2 = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: 'Failed to save post', details: error.message }, { status: status2 });
  }
  return NextResponse.json({ success: true, post: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { error } = await adminClient().from('blog_posts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
