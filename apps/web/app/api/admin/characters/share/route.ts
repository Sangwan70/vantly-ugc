// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

interface ShareRequestBody {
  item?: {
    character_id?: string;
    name?: string | null;
    character_sheet_url?: string;
    portrait_url?: string | null;
    thumbnail_url?: string | null;
    description?: string | null;
  };
  user_ids?: string[];
}

/**
 * POST /api/admin/characters/share — admin-only. Pushes a snapshot of one
 * character into the selected users' own character libraries
 * (character_shares table; merged into GET /api/dashboard/characters,
 * which is also what every skill's saved-character picker and the agent's
 * list_my_characters tool read, so a recipient can use a shared character
 * immediately). Mirrors app/api/admin/gallery/share/route.ts exactly --
 * see that file and the character_shares migration for why this is
 * admin-only and denormalized.
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
  if (!item || !item.character_sheet_url) {
    return NextResponse.json({ error: 'invalid_item' }, { status: 400 });
  }
  if (userIds.length === 0) {
    return NextResponse.json({ error: 'no_recipients' }, { status: 400 });
  }
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
    source_character_id: item.character_id ?? null,
    name: item.name ?? null,
    character_sheet_url: item.character_sheet_url,
    portrait_url: item.portrait_url ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    description: item.description ?? null,
  }));

  const { data, error } = await admin.from('character_shares').insert(rows).select('id');
  if (error) {
    return NextResponse.json({ error: 'share_failed', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ shared: data?.length ?? 0 });
}
