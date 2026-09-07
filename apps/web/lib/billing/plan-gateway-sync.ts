// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createStripePrice,
  createRazorpayPlan,
  createPaypalPlan,
  StripeAdminApiError,
  RazorpayAdminApiError,
  PaypalAdminApiError,
} from './gateway-admin';
import {
  getPaymentGatewaySettingsRow,
  resolveStripeCredentials,
  resolveRazorpayCredentials,
  resolvePaypalCredentials,
} from './gateway-settings';

export interface GatewayMintResult {
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
  paypal_plan_id: string | null;
  warnings: string[];
}

/**
 * Mint whichever of Stripe price / RazorPay plan / PayPal plan a plan tier
 * is currently missing, given its display name and USD-cent price.
 * Credentials for each gateway are resolved from the admin-configured
 * payment_gateway_settings row (falling back to env vars) via
 * gateway-settings.ts -- so an admin entering keys in Settings -> Payment
 * Gateways takes effect here immediately, no redeploy needed.
 *
 * Both Stripe and RazorPay treat prices/plans as immutable -- there is no
 * "update the amount" call for either -- and PayPal Billing Plans are the
 * same. So an id is only ever minted when the caller has already decided
 * the old one (if any) no longer applies:
 *
 *   - plans/route.ts POST (create): existing ids are always null (new row),
 *     so every configured gateway mints.
 *   - plans/[slug]/route.ts PUT, when price_usd_cents changes: the caller
 *     passes null for all three existing ids, since the OLD ids were
 *     minted for the OLD price and must not be kept around attached to a
 *     new amount -- this forces a fresh mint on every configured gateway.
 *   - plans/[slug]/sync-gateway/route.ts and the Payment Gateways tab's
 *     "sync all plans" action: the caller passes the plan's actual current
 *     ids, so only whichever gateway(s) are still null (e.g. added
 *     credentials after the plan was created, or a previous attempt
 *     failed) get retried; an id that's already set is left untouched
 *     rather than re-minted (re-minting an already-successful gateway
 *     would create a redundant, orphaned Product/Plan for no reason).
 *
 * A failure on one gateway never blocks the others -- e.g. no PayPal
 * credentials configured yet is expected and should not stop the Stripe/
 * RazorPay mints from succeeding. Failures come back as human-readable
 * `warnings`, meant to be surfaced in the route's JSON response rather than
 * thrown -- a gateway outage or missing credential should still let the
 * admin save display-copy/limit changes on the plan row itself. A gateway
 * with no credentials configured at all (source 'none') is skipped
 * silently rather than warned about -- that's an expected, common state
 * (e.g. PayPal not set up yet), not a failure worth flagging every time a
 * plan is saved.
 */
export async function mintMissingGatewayIds(
  admin: SupabaseClient,
  plan: {
    display_name: string;
    price_usd_cents: number;
    stripe_price_id: string | null;
    razorpay_plan_id: string | null;
    paypal_plan_id?: string | null;
  },
): Promise<GatewayMintResult> {
  const warnings: string[] = [];
  let stripe_price_id = plan.stripe_price_id;
  let razorpay_plan_id = plan.razorpay_plan_id;
  let paypal_plan_id = plan.paypal_plan_id ?? null;

  const settingsRow = await getPaymentGatewaySettingsRow(admin);

  if (!stripe_price_id) {
    const stripeCreds = resolveStripeCredentials(settingsRow);
    if (stripeCreds.secretKey) {
      try {
        const price = await createStripePrice({
          secretKey: stripeCreds.secretKey,
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
  }

  if (!razorpay_plan_id) {
    const razorpayCreds = resolveRazorpayCredentials(settingsRow);
    if (razorpayCreds.keyId && razorpayCreds.keySecret) {
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
          keyId: razorpayCreds.keyId,
          keySecret: razorpayCreds.keySecret,
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
  }

  if (!paypal_plan_id) {
    const paypalCreds = resolvePaypalCredentials(settingsRow);
    if (paypalCreds.clientId && paypalCreds.clientSecret) {
      try {
        const paypalPlan = await createPaypalPlan({
          clientId: paypalCreds.clientId,
          clientSecret: paypalCreds.clientSecret,
          mode: paypalCreds.mode,
          displayName: plan.display_name,
          unitAmountCents: plan.price_usd_cents,
        });
        paypal_plan_id = paypalPlan.id;
      } catch (err) {
        const message =
          err instanceof PaypalAdminApiError || err instanceof Error ? err.message : String(err);
        warnings.push(`PayPal plan mint failed: ${message}`);
      }
    }
  }

  return { stripe_price_id, razorpay_plan_id, paypal_plan_id, warnings };
}
