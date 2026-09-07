// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * INR <-> platform-credit conversion for RazorPay, ported verbatim (logic
 * unchanged) from supabase/functions/_shared/currency.ts (a Supabase Edge
 * Function -- see routes/v1/billing/checkout.ts's file comment for why this
 * exists here instead of there).
 *
 * Vantly's credit ledger is USD-cent-denominated everywhere (1 credit =
 * $0.01 = CREDITS_PER_CENT in checkout.ts). A RazorPay PAYG payment is
 * settled in INR paise, so it must be converted through an INR-per-USD rate
 * before crediting -- get this wrong and it's the exact ~89x over-crediting
 * bug AutoGPT's platform hit in production from treating paise as cents 1:1.
 *
 * The rate is read from the `currencies` admin table (Settings -> Currency
 * tab) so it can be corrected without a redeploy. This function
 * deliberately THROWS if the INR row is missing or inactive rather than
 * silently falling back to a guessed rate -- a wrong silent guess is
 * exactly the failure mode above; a thrown error instead dead-letters the
 * webhook for retry/investigation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Return the current INR-per-USD rate from the currencies table
 * (currencies.exchange_rate_to_usd for code='INR'), where
 * `amount_in_inr = amount_in_usd * exchange_rate_to_usd`.
 *
 * Throws if no INR row exists, or the row is not active -- both mean the
 * deployment isn't actually configured to accept INR payments yet, even if
 * the active gateway resolves to razorpay.
 */
export async function getInrToUsdRate(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('currencies')
    .select('exchange_rate_to_usd, is_active')
    .eq('code', 'INR')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read INR exchange rate: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      'No INR row in currencies table -- run the RazorPay billing migration, or configure the INR rate in Settings -> Currency before accepting RazorPay payments',
    );
  }
  if (!data.is_active) {
    throw new Error(
      'INR is not marked active in Settings -> Currency -- activate it before accepting RazorPay payments',
    );
  }

  const rate = Number(data.exchange_rate_to_usd);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid INR exchange rate configured: ${data.exchange_rate_to_usd}`);
  }
  return rate;
}

/**
 * Convert an INR paise amount into platform credits (1 credit = $0.01),
 * given the current INR-per-USD rate from getInrToUsdRate().
 *
 *   credits = paise / 100 (-> INR) / rate (-> USD) * 100 (-> USD cents)
 *           = paise / rate
 */
export function paiseToCredits(amountPaise: number, inrToUsdRate: number): number {
  return Math.round(amountPaise / inrToUsdRate);
}

/** Convert a USD-cent credit amount into INR paise at the given rate (the inverse of paiseToCredits). */
export function creditsToPaise(credits: number, inrToUsdRate: number): number {
  return Math.round(credits * inrToUsdRate);
}
