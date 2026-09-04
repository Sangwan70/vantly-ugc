// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { mintMissingGatewayIds } from '@/lib/billing/plan-gateway-sync';

const ALLOWED_FIELDS = [
  'display_name',
  'description',
  'badge',
  'bg_image_url',
  'features',
  'monthly_credits',
  'price_usd_cents',
  'max_resolution',
  'max_video_duration_seconds',
  'has_watermark',
  'has_priority',
  'has_api_access',
  'max_concurrent_jobs',
  'is_active',
  'is_purchasable',
  'sort_order',
] as const;

/**
 * Admin: update a plan tier's copy, limits, active/purchasable flags, and
 * sort order -- all freely editable, since nothing live reads this table
 * yet (see the migration header comment). The one field handled specially
 * is price_usd_cents: because Stripe Prices and RazorPay Plans are both
 * immutable, changing it never mutates a gateway object in place -- it
 * mints a NEW Stripe price and RazorPay plan and stores their ids,
 * discarding the old ids (which described the old amount). A gateway
 * failure during that mint is non-fatal: it's returned as a `warnings`
 * entry and the row still saves with whichever id(s) succeeded (possibly
 * neither) -- use sync-gateway to retry later rather than losing the rest
 * of the edit.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: existing, error: fetchError } = await admin
    .from('plans')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to load plan', details: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  const updateRow: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) updateRow[field] = body[field];
  }
  updateRow.updated_by = user.id;

  const priceIsChanging =
    Object.prototype.hasOwnProperty.call(updateRow, 'price_usd_cents') &&
    updateRow.price_usd_cents !== existing.price_usd_cents;

  let warnings: string[] = [];
  if (priceIsChanging && typeof updateRow.price_usd_cents === 'number') {
    const displayName =
      typeof updateRow.display_name === 'string' ? updateRow.display_name : existing.display_name;
    // Force a fresh mint on both gateways -- the OLD ids (if any) were for
    // the OLD price and must not carry over onto the new amount.
    const mint = await mintMissingGatewayIds(admin, {
      display_name: displayName,
      price_usd_cents: updateRow.price_usd_cents,
      stripe_price_id: null,
      razorpay_plan_id: null,
    });
    warnings = mint.warnings;
    updateRow.stripe_price_id = mint.stripe_price_id;
    updateRow.razorpay_plan_id = mint.razorpay_plan_id;
  }

  const { data: updated, error: updateError } = await admin
    .from('plans')
    .update(updateRow)
    .eq('slug', slug)
    .select('*')
    .single();

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update plan', details: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan: updated, warnings });
}
