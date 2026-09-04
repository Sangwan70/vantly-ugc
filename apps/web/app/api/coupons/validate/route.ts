// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * Any authenticated user: check whether a coupon code is currently
 * redeemable for them, without redeeming it.
 *
 * Calls the read-only validate_coupon() RPC (see 20260904170000_add_coupons.sql)
 * which never locks the coupon row or writes anything -- checking a code
 * can never burn a redemption. Not wired into checkout yet (see that
 * migration's header comment); this route exists so a coupon-entry UI can
 * be built ahead of that without depending on it.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }
  const planSlug = typeof body?.plan_slug === 'string' ? body.plan_slug : null;

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await admin.rpc('validate_coupon', {
    p_code: code,
    p_user_id: user.id,
    p_plan_slug: planSlug,
  });

  if (error) {
    return NextResponse.json({ error: 'Failed to validate coupon', details: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
