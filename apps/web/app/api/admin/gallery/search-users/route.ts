// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/**
 * GET /api/admin/gallery/search-users?q=<text> — admin-only lookup used by
 * the gallery "Share with users" picker (see dashboard/gallery/_generations-tab.tsx).
 * Deliberately search-only, never a full-directory listing: with ~3.4k users
 * on this platform, handing back the whole list to render client-side would
 * both be slow and expose the entire user base to whoever opens the picker
 * (see the 2026-09-19 feature discussion this shipped from — "search by
 * email/name" was the explicit choice over "full scrollable list").
 *
 * Same auth.admin.listUsers() pagination pattern as app/api/admin/users —
 * that route's own comment explains why: listUsers caps at 1000/page.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    type AuthUser = Awaited<ReturnType<typeof admin.auth.admin.listUsers>>['data']['users'][number];
    const matches: Array<{ id: string; email: string; display_name: string | null }> = [];
    const MAX_RESULTS = 20;

    // Paginate auth.users, filtering by email as we go so we can stop early
    // once we have enough matches instead of always walking all ~3.4k rows.
    for (let page = 1; page <= 50 && matches.length < MAX_RESULTS; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const batch: AuthUser[] = data?.users ?? [];
      if (batch.length === 0) break;

      const emailHits = batch.filter((u) => (u.email ?? '').toLowerCase().includes(q));
      if (emailHits.length > 0) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('id, display_name')
          .in('id', emailHits.map((u) => u.id));
        const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string | null]));
        for (const u of emailHits) {
          if (matches.length >= MAX_RESULTS) break;
          matches.push({ id: u.id, email: u.email ?? '', display_name: nameById.get(u.id) ?? null });
        }
      }

      if (batch.length < 1000) break;
    }

    // Also catch a name-only match (e.g. searching "Alex" with an email that
    // doesn't contain it), best-effort -- a single ilike pass over `profiles`.
    if (matches.length < MAX_RESULTS) {
      const { data: nameHits } = await admin
        .from('profiles')
        .select('id, display_name')
        .ilike('display_name', `%${q}%`)
        .limit(MAX_RESULTS - matches.length);
      const alreadyHave = new Set(matches.map((m) => m.id));
      const newIds = (nameHits ?? []).map((p) => p.id as string).filter((id) => !alreadyHave.has(id));
      const nameById = new Map((nameHits ?? []).map((p) => [p.id as string, p.display_name as string | null]));
      // Look these specific ids up directly rather than re-paginating all
      // ~3.4k auth users -- a name match can be for any user regardless of
      // where they'd fall in listUsers()'s page order.
      for (const id of newIds) {
        const { data: byId } = await admin.auth.admin.getUserById(id);
        if (byId?.user?.email) {
          matches.push({ id, email: byId.user.email, display_name: nameById.get(id) ?? null });
        }
      }
    }

    return NextResponse.json({ users: matches.slice(0, MAX_RESULTS) });
  } catch (err) {
    return NextResponse.json(
      { error: 'search_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }
}
