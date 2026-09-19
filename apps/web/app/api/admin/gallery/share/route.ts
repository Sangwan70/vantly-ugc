// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

const SOURCE_KINDS = new Set(['legacy', 'vnext_skill', 'vnext_primitive']);

interface ShareRequestBody {
  item?: {
    source?: string;
    run_id?: string;
    primitive?: string | null;
    media_url?: string;
    thumbnail_url?: string | null;
    duration_seconds?: number | null;
    title?: string | null;
    prompt?: string | null;
  };
  user_ids?: string[];
}

/**
 * POST /api/admin/gallery/share — admin-only. Pushes a snapshot of one
 * gallery item into the selected users' own galleries (gallery_shares
 * table; merged into GET /v1/me/gallery by services/api-v2's
 * routes/v1/me-gallery.ts). Denormalized on purpose -- see the migration's
 * header comment -- so the shared copy keeps rendering even if the source
 * run is later deleted.
 *
 * Deliberately admin-only (no owner-initiated peer sharing): this app has
 * no team/follow model, and unprompted writes into another customer's
 * account are a real trust boundary -- see the 2026-09-19 feature
 * discussion this shipped from.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: ShareRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const item = body.item;
  const userIds = Array.isArray(body.user_ids) ? body.user_ids.filter((id) => typeof id === 'string' && id) : [];
  if (!item || !item.media_url || !item.source || !SOURCE_KINDS.has(item.source)) {
    return NextResponse.json({ error: 'invalid_item' }, { status: 400 });
  }
  if (userIds.length === 0) {
    return NextResponse.json({ error: 'no_recipients' }, { status: 400 });
  }
  // Sane upper bound on a single bulk-share action.
  if (userIds.length > 200) {
    return NextResponse.json({ error: 'too_many_recipients', detail: 'Share to at most 200 users at a time.' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const sharedByLabel = user.email;
  const rows = userIds.map((recipientId) => ({
    shared_with_user_id: recipientId,
    shared_by_user_id: user.id,
    shared_by_label: sharedByLabel,
    source_kind: item.source,
    source_run_id: item.run_id ?? null,
    primitive: item.primitive ?? null,
    media_url: item.media_url,
    thumbnail_url: item.thumbnail_url ?? null,
    duration_seconds: item.duration_seconds ?? null,
    title: item.title ?? null,
    prompt: item.prompt ?? null,
  }));

  const { data, error } = await admin.from('gallery_shares').insert(rows).select('id');
  if (error) {
    return NextResponse.json({ error: 'share_failed', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ shared: data?.length ?? 0 });
}
