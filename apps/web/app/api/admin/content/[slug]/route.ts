// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { FIXED_SLUGS } from '@/lib/content/get-page';
import { sanitizeStaticPageHtml } from '@/lib/content/sanitize-html';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function isFixedSlug(slug: string): boolean {
  return (FIXED_SLUGS as readonly string[]).includes(slug);
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!isFixedSlug(slug)) {
    return NextResponse.json({ error: `Unknown slug. Must be one of: ${FIXED_SLUGS.join(', ')}` }, { status: 400 });
  }

  const { data, error } = await adminClient().from('static_pages').select('*').eq('slug', slug).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // null is a valid response here -- "no row yet, still using the hardcoded default".
  return NextResponse.json({ page: data ?? null });
}

/**
 * Upsert. slug is restricted to the fixed set (not admin-creatable) --
 * this is the server-side enforcement the plan document itself calls for
 * ("keep the slug set enumerated and validated server-side rather than
 * letting the UI create arbitrary rows"). content_html is ALWAYS run
 * through sanitizeStaticPageHtml() here, unconditionally, regardless of
 * what the client claims it already did -- the client-side editor may show
 * a sanitized preview, but this route is the actual security boundary.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!isFixedSlug(slug)) {
    return NextResponse.json({ error: `Unknown slug. Must be one of: ${FIXED_SLUGS.join(', ')}` }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const overlay = Number(body.hero_overlay_opacity);
  const row = {
    slug,
    title,
    content_html: sanitizeStaticPageHtml(typeof body.content_html === 'string' ? body.content_html : ''),
    hero_image_url: typeof body.hero_image_url === 'string' ? body.hero_image_url.trim() || null : null,
    hero_video_url: typeof body.hero_video_url === 'string' ? body.hero_video_url.trim() || null : null,
    hero_overlay_opacity: Number.isFinite(overlay) ? Math.min(100, Math.max(0, Math.round(overlay))) : 45,
    cta_primary_text: typeof body.cta_primary_text === 'string' ? body.cta_primary_text.trim() || null : null,
    cta_secondary_text: typeof body.cta_secondary_text === 'string' ? body.cta_secondary_text.trim() || null : null,
    updated_by: user.id,
  };

  const { data, error } = await adminClient()
    .from('static_pages')
    .upsert(row, { onConflict: 'slug' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to save page', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, page: data });
}

/** Reverts a slug back to "no row" -- i.e. back to the hardcoded default. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!isFixedSlug(slug)) {
    return NextResponse.json({ error: `Unknown slug. Must be one of: ${FIXED_SLUGS.join(', ')}` }, { status: 400 });
  }

  const { error } = await adminClient().from('static_pages').delete().eq('slug', slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
