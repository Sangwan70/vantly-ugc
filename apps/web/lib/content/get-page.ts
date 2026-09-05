// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Server-only helper: read one static_pages row by slug, for the marketing
 * pages that read from this table (see FIXED_SLUGS below). Returns null if
 * no row exists yet -- callers fall back to their own hardcoded default
 * copy, exactly as today, until an admin actually edits that slug.
 *
 * Never import into a 'use client' component -- this uses the service-role
 * key (RLS on static_pages has no public policy, see the migration).
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

export const FIXED_SLUGS = ['pricing', 'blog', 'privacy', 'terms', 'docs', 'home', 'contact'] as const;
export type StaticPageSlug = (typeof FIXED_SLUGS)[number];

export interface StaticPageRow {
  slug: string;
  title: string;
  content_html: string;
  hero_image_url: string | null;
  hero_video_url: string | null;
  hero_overlay_opacity: number;
  cta_primary_text: string | null;
  cta_secondary_text: string | null;
  updated_at: string;
}

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getStaticPage(slug: StaticPageSlug): Promise<StaticPageRow | null> {
  try {
    const { data, error } = await adminClient()
      .from('static_pages')
      .select('slug, title, content_html, hero_image_url, hero_video_url, hero_overlay_opacity, cta_primary_text, cta_secondary_text, updated_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as StaticPageRow;
  } catch {
    // A missing table (pre-migration) or any other read failure just means
    // "fall back to hardcoded copy" -- a CMS outage should never take down
    // a marketing page.
    return null;
  }
}
