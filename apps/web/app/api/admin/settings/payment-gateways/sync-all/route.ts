// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { mintMissingGatewayIds } from '@/lib/billing/plan-gateway-sync';

/**
 * Admin: retry minting whichever gateway id(s) are still missing, across
 * every priced plan tier at once -- the bulk equivalent of the Admin Plans
 * page's per-plan "Sync gateway" button. Exists so "we should have the same
 * plans for RazorPay and PayPal" (as Stripe already has) can be satisfied
 * in one click from Settings -> Payment Gateways right after an admin
 * saves new credentials, instead of visiting each plan individually.
 *
 * Same non-fatal-per-gateway semantics as mintMissingGatewayIds itself: a
 * plan with e.g. no PayPal credentials configured just keeps a null
 * paypal_plan_id and no warning; a plan whose gateway call actually failed
 * gets a warning entry naming it.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: plans, error: fetchError } = await admin
    .from('plans')
    .select('*')
    .not('price_usd_cents', 'is', null)
    .order('sort_order', { ascending: true });

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to load plans', details: fetchError.message }, { status: 500 });
  }

  const results: { slug: string; warnings: string[] }[] = [];

  for (const plan of plans ?? []) {
    if (plan.stripe_price_id && plan.razorpay_plan_id && plan.paypal_plan_id) {
      continue; // already fully synced
    }
    const mint = await mintMissingGatewayIds(admin, {
      display_name: plan.display_name,
      price_usd_cents: plan.price_usd_cents,
      stripe_price_id: plan.stripe_price_id,
      razorpay_plan_id: plan.razorpay_plan_id,
      paypal_plan_id: plan.paypal_plan_id,
    });
    const { error: updateError } = await admin
      .from('plans')
      .update({
        stripe_price_id: mint.stripe_price_id,
        razorpay_plan_id: mint.razorpay_plan_id,
        paypal_plan_id: mint.paypal_plan_id,
        updated_by: user.id,
      })
      .eq('id', plan.id);
    if (updateError) {
      results.push({ slug: plan.slug, warnings: [...mint.warnings, `Failed to save: ${updateError.message}`] });
    } else if (mint.warnings.length) {
      results.push({ slug: plan.slug, warnings: mint.warnings });
    }
  }

  return NextResponse.json({ success: true, results });
}
