// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { mintMissingGatewayIds } from '@/lib/billing/plan-gateway-sync';

/**
 * Admin: list / create plan tiers in the new `plans` table.
 *
 * Phase 1 of the Admin Plans milestone -- see the migration header comment
 * in 20260904160000_plans_table.sql. This table is not yet read by
 * checkout, webhook-stripe, webhook-razorpay, or credits-check, so nothing
 * here can affect a live checkout or an existing subscriber; rewiring those
 * consumers onto this table is a deliberately separate follow-up.
 */

const ALLOWED_FIELDS = [
  'slug',
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

  const { data: plans, error } = await admin
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to list plans', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ plans });
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
  if (!body || typeof body.slug !== 'string' || !body.slug.trim()) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }
  if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) insertRow[field] = body[field];
  }
  insertRow.updated_by = user.id;

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: created, error: insertError } = await admin
    .from('plans')
    .insert(insertRow)
    .select('*')
    .single();

  if (insertError) {
    const status = insertError.code === '23505' ? 409 : 500;
    return NextResponse.json(
      { error: 'Failed to create plan', details: insertError.message },
      { status },
    );
  }

  // A newly-created plan with a price is worth minting gateway ids for
  // right away -- it's a brand new row, nothing live references it yet
  // either way, so there's no "existing subscriber" risk to weigh here.
  let warnings: string[] = [];
  if (typeof created.price_usd_cents === 'number') {
    const mint = await mintMissingGatewayIds(admin, {
      display_name: created.display_name,
      price_usd_cents: created.price_usd_cents,
      stripe_price_id: created.stripe_price_id,
      razorpay_plan_id: created.razorpay_plan_id,
    });
    warnings = mint.warnings;
    if (mint.stripe_price_id || mint.razorpay_plan_id) {
      const { data: updated, error: updateError } = await admin
        .from('plans')
        .update({
          stripe_price_id: mint.stripe_price_id,
          razorpay_plan_id: mint.razorpay_plan_id,
        })
        .eq('id', created.id)
        .select('*')
        .single();
      if (!updateError && updated) {
        return NextResponse.json({ success: true, plan: updated, warnings });
      }
    }
  }

  return NextResponse.json({ success: true, plan: created, warnings });
}
