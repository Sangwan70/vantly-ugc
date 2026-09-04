// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

const PAGE_SIZE = 200;

/**
 * Admin: list redemptions for one coupon, most recent first.
 *
 * profiles has no email column (email lives in auth.users), so each row's
 * user_id is resolved to an email via a per-row admin.auth.admin.getUserById
 * call. Fine at this table's expected scale (a single coupon's redemption
 * count, capped at PAGE_SIZE per request); if a coupon ever needs to
 * support tens of thousands of redemptions this should switch to a single
 * batched auth.admin.listUsers pass the way apps/web/app/api/admin/users
 * already does for the full user list, rather than N individual lookups.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: redemptions, error } = await admin
    .from('coupon_redemptions')
    .select('id, user_id, plan_slug, redeemed_at')
    .eq('coupon_id', id)
    .order('redeemed_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    return NextResponse.json({ error: 'Failed to list redemptions', details: error.message }, { status: 500 });
  }

  const withEmails = await Promise.all(
    (redemptions ?? []).map(async (r) => {
      const { data } = await admin.auth.admin.getUserById(r.user_id);
      return { ...r, email: data?.user?.email ?? null };
    }),
  );

  return NextResponse.json({ redemptions: withEmails, truncated: (redemptions?.length ?? 0) === PAGE_SIZE });
}
