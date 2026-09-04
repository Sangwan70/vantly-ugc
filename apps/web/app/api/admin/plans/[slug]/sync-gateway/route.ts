// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { mintMissingGatewayIds } from '@/lib/billing/plan-gateway-sync';

/**
 * Admin: retry minting whichever gateway id(s) a plan is still missing.
 *
 * Exists because plans/[slug]'s PUT route treats a gateway mint failure as
 * non-fatal (see its doc comment) -- a plan can end up saved with a price
 * but a null stripe_price_id and/or razorpay_plan_id if the gateway was
 * down or misconfigured at edit time. This route re-attempts only the
 * missing one(s); an id that's already set is left untouched (see
 * mintMissingGatewayIds's doc comment for why re-minting an
 * already-successful gateway would be wrong, not just wasteful).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
  if (typeof existing.price_usd_cents !== 'number') {
    return NextResponse.json({ error: 'Plan has no price_usd_cents set -- nothing to sync' }, { status: 400 });
  }
  if (existing.stripe_price_id && existing.razorpay_plan_id) {
    return NextResponse.json({ success: true, plan: existing, warnings: [], message: 'Already synced' });
  }

  const mint = await mintMissingGatewayIds(admin, {
    display_name: existing.display_name,
    price_usd_cents: existing.price_usd_cents,
    stripe_price_id: existing.stripe_price_id,
    razorpay_plan_id: existing.razorpay_plan_id,
  });

  const { data: updated, error: updateError } = await admin
    .from('plans')
    .update({
      stripe_price_id: mint.stripe_price_id,
      razorpay_plan_id: mint.razorpay_plan_id,
      updated_by: user.id,
    })
    .eq('slug', slug)
    .select('*')
    .single();

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save synced ids', details: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan: updated, warnings: mint.warnings });
}
