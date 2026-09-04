// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/**
 * Admin: list / create coupons.
 *
 * See 20260904170000_add_coupons.sql for the full design (internal-only
 * discount codes; percent_off/fixed_off are not yet applied at checkout --
 * only credits-type coupons have a live effect today, via redeem_coupon's
 * call to add_purchased_credits).
 */

export async function GET() {
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

  const { data: coupons, error } = await admin
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to list coupons', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }
  if (!['percent_off', 'fixed_off', 'credits'].includes(body.type)) {
    return NextResponse.json({ error: "type must be one of 'percent_off', 'fixed_off', 'credits'" }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {
    code,
    description: typeof body.description === 'string' ? body.description.trim() || null : null,
    type: body.type,
    percent_off: body.type === 'percent_off' ? Number(body.percent_off) : null,
    fixed_off_cents: body.type === 'fixed_off' ? Number(body.fixed_off_cents) : null,
    credits_amount: body.type === 'credits' ? Number(body.credits_amount) : null,
    applicable_plans: Array.isArray(body.applicable_plans) ? body.applicable_plans : [],
    max_redemptions: body.max_redemptions != null ? Number(body.max_redemptions) : null,
    per_user_limit: body.per_user_limit != null ? Number(body.per_user_limit) : 1,
    valid_from: body.valid_from || null,
    valid_until: body.valid_until || null,
    is_active: body.is_active !== false,
    created_by: user.id,
  };

  // Mirrors the table's own CHECK (coupons_discount_matches_type) so a bad
  // request gets a clear 400 rather than a raw Postgres constraint error.
  if (insertRow.type === 'percent_off' && (typeof insertRow.percent_off !== 'number' || !Number.isFinite(insertRow.percent_off))) {
    return NextResponse.json({ error: 'percent_off is required for type=percent_off' }, { status: 400 });
  }
  if (insertRow.type === 'fixed_off' && (typeof insertRow.fixed_off_cents !== 'number' || !Number.isFinite(insertRow.fixed_off_cents))) {
    return NextResponse.json({ error: 'fixed_off_cents is required for type=fixed_off' }, { status: 400 });
  }
  if (insertRow.type === 'credits' && (typeof insertRow.credits_amount !== 'number' || !Number.isFinite(insertRow.credits_amount))) {
    return NextResponse.json({ error: 'credits_amount is required for type=credits' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: created, error: insertError } = await admin
    .from('coupons')
    .insert(insertRow)
    .select('*')
    .single();

  if (insertError) {
    const status = insertError.code === '23505' ? 409 : 500;
    return NextResponse.json({ error: 'Failed to create coupon', details: insertError.message }, { status });
  }

  return NextResponse.json({ success: true, coupon: created });
}
