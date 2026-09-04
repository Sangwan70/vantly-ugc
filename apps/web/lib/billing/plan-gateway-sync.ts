// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createStripePrice,
  createRazorpayPlan,
  StripeAdminApiError,
  RazorpayAdminApiError,
} from './gateway-admin';

export interface GatewayMintResult {
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
  warnings: string[];
}

/**
 * Mint whichever of Stripe price / RazorPay plan a plan tier is currently
 * missing, given its display name and USD-cent price.
 *
 * Both gateways treat prices/plans as immutable -- there is no "update the
 * amount" call for either -- so an id is only ever minted when the caller
 * has already decided the old one (if any) no longer applies:
 *
 *   - plans/route.ts POST (create): existing ids are always null (new row),
 *     so both gateways mint.
 *   - plans/[slug]/route.ts PUT, when price_usd_cents changes: the caller
 *     passes null for both existing ids, since the OLD ids were minted for
 *     the OLD price and must not be kept around attached to a new amount --
 *     this forces a fresh mint on both gateways.
 *   - plans/[slug]/sync-gateway/route.ts: the caller passes the plan's
 *     actual current ids, so only whichever gateway is still null (e.g. the
 *     other one failed on a previous attempt) gets retried; an id that's
 *     already set is left untouched rather than re-minted (re-minting an
 *     already-successful gateway would create a redundant, orphaned Stripe
 *     Product/RazorPay Plan for no reason).
 *
 * A failure on one gateway never blocks the other -- e.g. RAZORPAY_API_KEY
 * being unset in a Stripe-only deployment is expected and should not stop
 * the Stripe mint from succeeding. Failures come back as human-readable
 * `warnings`, meant to be surfaced in the route's JSON response rather than
 * thrown -- a gateway outage or missing credential should still let the
 * admin save display-copy/limit changes on the plan row itself.
 */
export async function mintMissingGatewayIds(
  admin: SupabaseClient,
  plan: {
    display_name: string;
    price_usd_cents: number;
    stripe_price_id: string | null;
    razorpay_plan_id: string | null;
  },
): Promise<GatewayMintResult> {
  const warnings: string[] = [];
  let stripe_price_id = plan.stripe_price_id;
  let razorpay_plan_id = plan.razorpay_plan_id;

  if (!stripe_price_id) {
    try {
      const price = await createStripePrice({
        displayName: plan.display_name,
        unitAmountCents: plan.price_usd_cents,
      });
      stripe_price_id = price.id;
    } catch (err) {
      const message =
        err instanceof StripeAdminApiError || err instanceof Error ? err.message : String(err);
      warnings.push(`Stripe price mint failed: ${message}`);
    }
  }

  if (!razorpay_plan_id) {
    try {
      const { data: currencyRow, error: currencyError } = await admin
        .from('currencies')
        .select('exchange_rate_to_usd, is_active')
        .eq('code', 'INR')
        .maybeSingle();
      if (currencyError) throw new Error(currencyError.message);
      if (!currencyRow) throw new Error('No INR row in currencies table');
      if (!currencyRow.is_active) {
        throw new Error('INR is not marked active in Settings -> Currency');
      }
      const rate = Number(currencyRow.exchange_rate_to_usd);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Invalid INR exchange rate configured: ${currencyRow.exchange_rate_to_usd}`);
      }

      // Same conversion as _shared/currency.ts's creditsToPaise -- 1 credit
      // = 1 USD cent in this ledger's convention, so price_usd_cents can be
      // treated as credits directly.
      const amountInrPaise = Math.round(plan.price_usd_cents * rate);
      const razorpayPlan = await createRazorpayPlan({
        displayName: plan.display_name,
        amountInrPaise,
      });
      razorpay_plan_id = razorpayPlan.id;
    } catch (err) {
      const message =
        err instanceof RazorpayAdminApiError || err instanceof Error ? err.message : String(err);
      warnings.push(`RazorPay plan mint failed: ${message}`);
    }
  }

  return { stripe_price_id, razorpay_plan_id, warnings };
}
