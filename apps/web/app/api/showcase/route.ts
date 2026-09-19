// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/showcase — PUBLIC, no auth. Backs the /showcase marketing page's
 * "See what Vantly UGC produces" strip. Replaces what used to be a
 * hardcoded CLIPS array in app/showcase/page.tsx with the admin-curated
 * showcase_items table (see app/api/admin/showcase/route.ts for how items
 * get added, and the 20260919200000 migration for why this table is public
 * -- it's marketing content by definition).
 *
 * force-dynamic + no-store: this project got burned once already this week
 * by a GET route handler whose bare fetch()/response got cached indefinitely
 * by Next's Data Cache (see the skills/runs/[id] route fix) -- not repeating
 * that mistake on a route that's *supposed* to reflect new admin curation
 * within seconds.
 */
export async function GET(): Promise<NextResponse> {
  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await admin
    .from('showcase_items')
    .select('id, media_url, label')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    // Fail soft -- a broken showcase fetch shouldn't break the marketing
    // page, just show it empty.
    return NextResponse.json({ items: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { items: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
