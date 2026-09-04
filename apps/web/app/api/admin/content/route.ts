// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { FIXED_SLUGS } from '@/lib/content/get-page';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Lists every fixed slug, whether or not it has a row yet -- so the admin
 * UI always shows the full editable set (matching AutoGPT's own "get or
 * seed a row per fixed slug" behavior), each annotated with whether it's
 * still using the hardcoded default (no row / edited: false) or has been
 * customized (edited: true).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: rows, error } = await adminClient()
    .from('static_pages')
    .select('slug, title, updated_at')
    .in('slug', FIXED_SLUGS as unknown as string[]);

  if (error) {
    return NextResponse.json({ error: 'Failed to list content', details: error.message }, { status: 500 });
  }

  const bySlug = new Map((rows ?? []).map((r) => [r.slug, r]));
  const pages = FIXED_SLUGS.map((slug) => {
    const row = bySlug.get(slug);
    return { slug, title: row?.title ?? null, updated_at: row?.updated_at ?? null, edited: !!row };
  });

  return NextResponse.json({ pages });
}
