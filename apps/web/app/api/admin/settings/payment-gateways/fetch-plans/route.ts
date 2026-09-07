// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import {
  getPaymentGatewaySettingsRow,
  resolveStripeCredentials,
  resolveRazorpayCredentials,
  resolvePaypalCredentials,
} from '@/lib/billing/gateway-settings';
import { listStripePrices, listRazorpayPlans, listPaypalPlans } from '@/lib/billing/gateway-admin';

/**
 * Admin: list whatever recurring prices/plans already exist directly on a
 * gateway's own side -- the "if the plans are on the Payment gateway side,
 * fetch from payment gateway" half of the Payment Gateways tab's plan
 * resolution. Read-only and informational: it does not import/link any of
 * these into the `plans` table automatically, since mapping a gateway's
 * existing price/plan to one of our tiers is a judgment call for the admin
 * to make by eye (name + amount), not something to guess at silently.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const gateway = req.nextUrl.searchParams.get('gateway');
  if (gateway !== 'stripe' && gateway !== 'razorpay' && gateway !== 'paypal') {
    return NextResponse.json({ error: 'gateway must be one of: stripe, razorpay, paypal' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let row;
  try {
    row = await getPaymentGatewaySettingsRow(admin);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load settings' }, { status: 500 });
  }

  try {
    if (gateway === 'stripe') {
      const creds = resolveStripeCredentials(row);
      if (!creds.secretKey) return NextResponse.json({ error: 'Stripe is not configured (no key in Settings or STRIPE_SECRET_KEY)' }, { status: 400 });
      const prices = await listStripePrices(creds.secretKey);
      return NextResponse.json({
        plans: prices.map((p) => ({
          id: p.id,
          name: (p.product as { name?: string } | string | undefined) && typeof p.product === 'object' ? (p.product as { name?: string }).name ?? p.id : p.id,
          amount: p.unit_amount,
          currency: p.currency,
          interval: (p as { recurring?: { interval?: string } }).recurring?.interval ?? null,
        })),
      });
    }
    if (gateway === 'razorpay') {
      const creds = resolveRazorpayCredentials(row);
      if (!creds.keyId || !creds.keySecret) return NextResponse.json({ error: 'RazorPay is not configured (no keys in Settings or RAZORPAY_API_KEY/SECRET)' }, { status: 400 });
      const plans = await listRazorpayPlans(creds.keyId, creds.keySecret);
      return NextResponse.json({
        plans: plans.map((p) => ({
          id: p.id,
          name: p.item?.name ?? p.id,
          amount: p.item?.amount,
          currency: p.item?.currency,
          interval: p.period,
        })),
      });
    }
    // paypal
    const creds = resolvePaypalCredentials(row);
    if (!creds.clientId || !creds.clientSecret) return NextResponse.json({ error: 'PayPal is not configured (no client id/secret in Settings)' }, { status: 400 });
    const plans = await listPaypalPlans(creds.clientId, creds.clientSecret, creds.mode);
    return NextResponse.json({
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        amount: null,
        currency: null,
        interval: null,
        status: p.status,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to fetch plans from gateway' }, { status: 502 });
  }
}
