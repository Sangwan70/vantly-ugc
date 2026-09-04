// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/**
 * Daily signup counts for the admin dashboard's trend chart.
 *
 * `?days=N` (default 30, capped at 90) — how far back to bucket. Days with
 * zero signups are included as 0 so the chart never has gaps.
 *
 * PostgREST caps a single select at max_rows (1000, same limit that bit
 * /api/admin/users before it paginated) — paginate `profiles.created_at`
 * past that cap the same way, since at 90 days this can exceed 1000 rows
 * well before Vantly's user base is large enough to need real SQL-side
 * date_trunc aggregation.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const daysParam = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, daysParam)) : 30;

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  async function fetchAllRows<T>(
    makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> {
    const PAGE = 1000;
    const all: T[] = [];
    for (let safety = 0; safety < 50; safety++) {
      const from = safety * PAGE;
      const { data, error } = await makeQuery(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    return all;
  }

  let rows: { created_at: string }[];
  try {
    rows = await fetchAllRows<{ created_at: string }>((from, to) =>
      admin
        .from('profiles')
        .select('created_at')
        .gte('created_at', cutoffIso)
        .range(from, to),
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to fetch signups' }, { status: 500 });
  }

  // Pre-fill every day in range (UTC) so the chart never has gaps for quiet days.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(d), 0);
  }
  for (const r of rows) {
    const key = dayKey(new Date(r.created_at));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    days: [...buckets.entries()].map(([date, count]) => ({ date, count })),
  });
}
