// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

// Deliberately narrow, matching the plan document's own stated rule
// ("once a coupon has live redemptions, don't allow editing its discount
// amount/type/tiers, only status/description/caps/expiry") -- discount
// shape (type/percent_off/fixed_off_cents/credits_amount) and
// applicable_plans are immutable once a coupon is created, the same
// rationale Stripe's own Coupon objects use. Deactivate + create a new
// coupon instead of mutating an existing one's discount.
const ALLOWED_FIELDS = [
  'description',
  'is_active',
  'max_redemptions',
  'per_user_limit',
  'valid_from',
  'valid_until',
] as const;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const updateRow: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) updateRow[field] = body[field];
  }
  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: updated, error } = await admin
    .from('coupons')
    .update(updateRow)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to update coupon', details: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, coupon: updated });
}
