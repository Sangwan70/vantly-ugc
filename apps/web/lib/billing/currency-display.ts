// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared display-currency helpers for pricing UI. Every USD price in this
 * codebase (plan tier prices, PAYG pack amounts) is authored as a plain USD
 * number -- nothing about how prices are STORED changes here. This only
 * affects how they're RENDERED when the active gateway is RazorPay (INR),
 * using the rate threaded through variable-context.tsx (see that file and
 * apps/web/app/layout.tsx for where it comes from and its caveats).
 *
 * Modeled directly on AutoGPT platform's frontend equivalent
 * (src/lib/currency.ts + src/hooks/useExchangeRate.ts) -- same symbol
 * function, same "cents vs raw amount" split, same INR
 * zero-decimal/en-IN-grouping formatting.
 */

import { useVariables } from '@/components/variable-context';

export interface CurrencyDisplayContext {
  currencySymbol: string;
  /** null when the active gateway is Stripe (USD, no conversion needed). */
  inrToUsdRate: number | null;
}

/** Read the three fields formatPlanPrice/formatCreditCents need straight off useVariables(), for call sites that don't want to destructure it themselves. */
export function useCurrencyDisplay(): CurrencyDisplayContext {
  const { currencySymbol, inrToUsdRate } = useVariables();
  return { currencySymbol, inrToUsdRate };
}

/**
 * Format a raw USD dollar amount (plan tier prices, PAYG pack "$39" style
 * amounts) in the active display currency.
 *
 * IMPORTANT caveat for RazorPay/INR: this is a DISPLAY ESTIMATE computed
 * from the Settings -> Currency exchange rate. For a subscription tier,
 * the amount RazorPay actually charges is fixed by whatever the
 * RAZORPAY_PLAN_* Plan ID was created with in RazorPay's dashboard/API --
 * independent of this rate, and can drift from it if the two aren't kept
 * in sync (there's no admin UI yet that ties a tier's real RazorPay Plan
 * price back to this estimate -- see the admin-replication report's
 * "Plans" phase). For a PAYG top-up, there is NO drift risk: checkout
 * computes the actual charged paise amount from this exact same rate at
 * request time, so the estimate and the real charge always agree.
 */
export function formatPlanPrice(usdAmount: number, ctx: CurrencyDisplayContext): string {
  if (ctx.inrToUsdRate === null) {
    return `${ctx.currencySymbol}${usdAmount.toFixed(usdAmount % 1 === 0 ? 0 : 2)}`;
  }
  const inrValue = usdAmount * ctx.inrToUsdRate;
  return `${ctx.currencySymbol}${inrValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Format a USD-cent amount (credit_transactions.amount-style values, e.g.
 * `tx.amount / 100` in the billing pages) the same way.
 */
export function formatPlanPriceCents(usdCents: number, ctx: CurrencyDisplayContext): string {
  return formatPlanPrice(usdCents / 100, ctx);
}

/**
 * Map a billing-history row's OWN `currency` field (returned per-row by
 * billing-history/index.ts, e.g. "usd" or "inr") to a display symbol.
 * Deliberately independent of the active-gateway context above: a
 * deployment that has switched gateways can have historical invoices in
 * the OTHER currency, and each row should show what it was actually
 * charged in, not today's active gateway.
 */
export function symbolForCurrencyCode(currencyCode: string | null | undefined): string {
  switch ((currencyCode ?? '').toLowerCase()) {
    case 'inr':
      return '₹';
    case 'usd':
      return '$';
    default:
      return '$';
  }
}

/** Format an already-known amount (in the row's own major currency unit, e.g. `inv.amount_paid`) with that row's own currency's symbol. */
export function formatInvoiceAmount(amount: number, currencyCode: string | null | undefined): string {
  const symbol = symbolForCurrencyCode(currencyCode);
  if (symbol === '₹') {
    return `${symbol}${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
  return `${symbol}${amount.toFixed(2)}`;
}
