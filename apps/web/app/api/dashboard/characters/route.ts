// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/dashboard/characters
 *
 * Lists the caller's reusable Content Machine characters (user_characters
 * rows where archived_at IS NULL), with a video_count derived from the
 * generation_jobs.character_id back-reference, merged with any characters
 * an admin has pushed into this user's library (character_shares — see
 * app/api/admin/characters/share/route.ts and the character_shares
 * migration's header comment; mirrors GET /v1/me/gallery's own
 * gallery_shares merge). Shared rows are tagged `shared: true` /
 * `shared_by` and are NOT editable (dashboard/actors/page.tsx gates Edit
 * off them) since the recipient doesn't own the source character.
 *
 * This is the ONE place characters are listed app-wide — dashboard/actors,
 * every skill's saved-character picker (_run-panel.tsx), and the agent's
 * list_my_characters tool all read this same endpoint — so a shared
 * character becomes usable everywhere the moment it's shared, not just
 * visible on the Actors page.
 *
 * Used by /content-machine — Characters tab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Not authenticated' } },
      { status: 401 },
    );
  }

  const { data: characters, error } = await supabase
    .from('user_characters')
    .select('id, name, source_kind, actor_slug, source_image_url, description, character_sheet_url, thumbnail_url, voice_brief, preset_default, signature_look, created_at')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }

  // character_shares has no RLS policy for end users (service-role only,
  // same posture as gallery_shares) — a plain admin client is required to
  // read the caller's own incoming shares here.
  let sharedRows: Array<Record<string, unknown>> = [];
  try {
    const admin = createAdminClient(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: shares, error: sharesErr } = await admin
      .from('character_shares')
      .select('id, name, character_sheet_url, portrait_url, thumbnail_url, description, created_at, shared_by_label')
      .eq('shared_with_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!sharesErr) sharedRows = shares ?? [];
  } catch {
    // Fail soft — a broken shares lookup shouldn't hide the user's own characters.
  }

  // Decorate each character with a count of completed videos. One round-
  // trip per character would be silly; aggregate in JS from a single
  // count-by-character query.
  const ids = (characters ?? []).map((c) => c.id);
  let videoCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: videos } = await supabase
      .from('generation_jobs')
      .select('character_id')
      .eq('user_id', user.id)
      .eq('operation', 'character_video')
      .eq('status', 'completed')
      .is('deleted_at', null)
      .in('character_id', ids);
    for (const row of (videos ?? []) as { character_id: string | null }[]) {
      if (row.character_id) videoCounts[row.character_id] = (videoCounts[row.character_id] ?? 0) + 1;
    }
  }

  const decorated = (characters ?? []).map((c) => ({
    ...c,
    video_count: videoCounts[c.id] ?? 0,
    shared: false as const,
    shared_by: null as string | null,
  }));

  const sharedDecorated = sharedRows.map((row) => ({
    id: `share-${row.id as string}`,
    name: (row.name as string | null) ?? 'Untitled character',
    source_kind: 'description' as const,
    actor_slug: null,
    source_image_url: null,
    description: (row.description as string | null) ?? null,
    character_sheet_url: row.character_sheet_url as string,
    thumbnail_url: (row.thumbnail_url as string | null) ?? (row.portrait_url as string | null) ?? null,
    voice_brief: null,
    preset_default: null,
    signature_look: null,
    created_at: row.created_at as string,
    video_count: 0,
    shared: true as const,
    shared_by: (row.shared_by_label as string | null) ?? null,
  }));

  const merged = [...decorated, ...sharedDecorated].sort(
    (a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
  );

  return NextResponse.json(
    { characters: merged },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
