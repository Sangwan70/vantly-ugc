// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

// The public marketing page keeps at most this many items -- "rolling
// window" per the 2026-09-19 feature request: adding an 11th item should
// drop the oldest, not grow the page forever. Each `kind` (see
// KindOf below) keeps its own independent window of this size --
// added 2026-09-22 alongside `kind` so publishing characters can't
// crowd out published videos or vice versa.
const SHOWCASE_WINDOW = 10;

type ShowcaseKind = 'video' | 'character';
function parseKind(raw: unknown): ShowcaseKind {
  return raw === 'character' ? 'character' : 'video';
}

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function requireAdmin(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email || !isAdminEmail(user.email)) return null;
  return { id: user.id, email: user.email };
}

/** GET /api/admin/showcase?kind=video|character — current curated list for that kind, newest first, for the admin UI to show what's already featured. `kind` defaults to 'video' for back-compat with the existing gallery admin UI. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const kind = parseKind(req.nextUrl.searchParams.get('kind'));
  const db = adminClient();
  const { data, error } = await db
    .from('showcase_items')
    .select('id, media_url, label, source_run_id, created_at')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(SHOWCASE_WINDOW);
  if (error) {
    return NextResponse.json({ error: 'lookup_failed', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

/** POST /api/admin/showcase — add one item, then trim to the SHOWCASE_WINDOW most recent. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: { media_url?: string; label?: string | null; source_run_id?: string | null; kind?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.media_url) {
    return NextResponse.json({ error: 'invalid_item' }, { status: 400 });
  }
  const kind = parseKind(body.kind);

  const db = adminClient();
  const { error: insertErr } = await db.from('showcase_items').insert({
    media_url: body.media_url,
    label: body.label ?? null,
    source_run_id: body.source_run_id ?? null,
    added_by_user_id: admin.id,
    kind,
  });
  if (insertErr) {
    return NextResponse.json({ error: 'add_failed', detail: insertErr.message }, { status: 500 });
  }

  // Rolling window: keep only the SHOWCASE_WINDOW most recent rows PER KIND.
  // Simpler to express here than as a DB trigger, and this route is the
  // only writer.
  const { data: all, error: listErr } = await db
    .from('showcase_items')
    .select('id, created_at')
    .eq('kind', kind)
    .order('created_at', { ascending: false });
  if (!listErr && all && all.length > SHOWCASE_WINDOW) {
    const staleIds = all.slice(SHOWCASE_WINDOW).map((r) => r.id as string);
    await db.from('showcase_items').delete().in('id', staleIds);
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/showcase?id=<uuid> — manually remove one item early. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const db = adminClient();
  const { error } = await db.from('showcase_items').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'delete_failed', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
