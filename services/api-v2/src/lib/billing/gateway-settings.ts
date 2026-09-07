// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Resolves which payment gateway live checkout/webhooks should use, and
 * which credentials to use for it, for api-v2's billing routes.
 *
 * This is the piece that finally unifies the three previously-separate
 * layers documented in supabase/migrations/20260907130000_payment_gateway_settings.sql:
 *   1. `plans` table (per-tier stripe_price_id/razorpay_plan_id/paypal_plan_id)
 *   2. `payment_gateway_settings` table (admin-configured active gateway + credentials)
 *   3. live checkout (previously 100% env-var-driven via the unreachable
 *      Supabase Edge Functions -- see routes/v1/billing/checkout.ts's file
 *      comment for why this self-hosted deployment needs api-v2 routes at
 *      all instead of Edge Functions)
 *
 * Gateway selection precedence (DB-first, env-fallback):
 *   - payment_gateway_settings.active_gateway, when explicitly set by an
 *     admin in Settings -> Payment Gateways, wins.
 *   - Otherwise falls back to the PAYMENT_GATEWAY env var, defaulting to
 *     "razorpay" -- this exactly matches the original Deno
 *     _shared/razorpay.ts's getActivePaymentGateway() default, so a
 *     deployment that has never touched the new admin tab behaves
 *     identically to before this port. See that file's own doc comment for
 *     why "razorpay" (not "stripe") is the safe unset-default here.
 *
 * PayPal is a valid `active_gateway` value. Unlike Stripe/RazorPay, there
 * was no original Deno Edge Function to port PayPal checkout/webhook logic
 * from (PayPal was only ever wired into the ADMIN plan-minting surface --
 * apps/web/lib/billing/plan-gateway-sync.ts's mintMissingGatewayIds, which
 * already mints real `plans.paypal_plan_id` values via
 * apps/web/lib/billing/gateway-admin.ts's createPaypalPlan) -- so
 * checkout.ts/webhook-paypal.ts's PayPal branches are a new integration
 * built directly against PayPal's REST API (see lib/billing/paypal.ts),
 * not a port of existing logic.
 *
 * Credential resolution (DB-first, env-fallback) mirrors
 * apps/web/lib/billing/gateway-settings.ts exactly (same table, same
 * precedence) so the admin-facing "from database"/"from environment"
 * distinction shown in Settings -> Payment Gateways stays consistent with
 * what live checkout actually uses.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type GatewayId = 'stripe' | 'razorpay' | 'paypal';
export type CredentialSource = 'database' | 'env' | 'none';

export interface PaymentGatewaySettingsRow {
  id: string;
  active_gateway: GatewayId | null;
  stripe_secret_key: string | null;
  razorpay_key_id: string | null;
  razorpay_key_secret: string | null;
  paypal_client_id: string | null;
  paypal_client_secret: string | null;
  paypal_mode: 'live' | 'sandbox';
  updated_at: string;
}

const DEFAULT_ROW: PaymentGatewaySettingsRow = {
  id: 'default',
  active_gateway: null,
  stripe_secret_key: null,
  razorpay_key_id: null,
  razorpay_key_secret: null,
  paypal_client_id: null,
  paypal_client_secret: null,
  paypal_mode: 'live',
  updated_at: new Date(0).toISOString(),
};

export async function getPaymentGatewaySettingsRow(
  db: SupabaseClient,
): Promise<PaymentGatewaySettingsRow> {
  const { data, error } = await db
    .from('payment_gateway_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_ROW, ...((data as Partial<PaymentGatewaySettingsRow> | null) ?? {}) };
}

/**
 * Resolve which gateway live checkout/webhooks should use.
 */
export function resolveActiveGateway(row: PaymentGatewaySettingsRow): GatewayId {
  const dbChoice = row.active_gateway;
  if (dbChoice === 'stripe' || dbChoice === 'razorpay' || dbChoice === 'paypal') return dbChoice;

  const raw = (process.env.PAYMENT_GATEWAY ?? 'razorpay').trim().toLowerCase();
  return raw === 'stripe' ? 'stripe' : 'razorpay';
}

export interface ResolvedStripeCredentials {
  secretKey: string | null;
  source: CredentialSource;
}
export interface ResolvedRazorpayCredentials {
  keyId: string | null;
  keySecret: string | null;
  source: CredentialSource;
}

function trimmed(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function resolveStripeCredentials(row: PaymentGatewaySettingsRow): ResolvedStripeCredentials {
  const dbKey = trimmed(row.stripe_secret_key);
  if (dbKey) return { secretKey: dbKey, source: 'database' };
  if (process.env.STRIPE_SECRET_KEY) return { secretKey: process.env.STRIPE_SECRET_KEY, source: 'env' };
  return { secretKey: null, source: 'none' };
}

export function resolveRazorpayCredentials(row: PaymentGatewaySettingsRow): ResolvedRazorpayCredentials {
  const dbKeyId = trimmed(row.razorpay_key_id);
  const dbKeySecret = trimmed(row.razorpay_key_secret);
  if (dbKeyId && dbKeySecret) return { keyId: dbKeyId, keySecret: dbKeySecret, source: 'database' };
  if (process.env.RAZORPAY_API_KEY && process.env.RAZORPAY_API_SECRET) {
    return { keyId: process.env.RAZORPAY_API_KEY, keySecret: process.env.RAZORPAY_API_SECRET, source: 'env' };
  }
  return { keyId: null, keySecret: null, source: 'none' };
}

export interface ResolvedPaypalCredentials {
  clientId: string | null;
  clientSecret: string | null;
  mode: 'live' | 'sandbox';
  source: CredentialSource;
}

/**
 * PayPal has no legacy env-var convention in this codebase (no
 * PAYPAL_CLIENT_ID/SECRET was ever read anywhere before the admin Payment
 * Gateways tab existed) -- env is still checked for forward-compatibility
 * with a self-hoster who sets one at deploy time, mirroring
 * apps/web/lib/billing/gateway-settings.ts's identical resolver.
 */
export function resolvePaypalCredentials(row: PaymentGatewaySettingsRow): ResolvedPaypalCredentials {
  const mode: 'live' | 'sandbox' = row.paypal_mode === 'sandbox' ? 'sandbox' : 'live';
  const dbClientId = trimmed(row.paypal_client_id);
  const dbClientSecret = trimmed(row.paypal_client_secret);
  if (dbClientId && dbClientSecret) return { clientId: dbClientId, clientSecret: dbClientSecret, mode, source: 'database' };
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    return { clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET, mode, source: 'env' };
  }
  return { clientId: null, clientSecret: null, mode, source: 'none' };
}

/**
 * Convenience combining the two steps above: load the settings row and
 * resolve both the active gateway and its credentials in one call. Most
 * routes (checkout, webhooks, stripe-portal, billing-history, auto-topup)
 * want exactly this.
 */
export async function resolveActiveGatewayAndCredentials(
  db: SupabaseClient,
): Promise<
  | { gateway: 'stripe'; stripe: ResolvedStripeCredentials }
  | { gateway: 'razorpay'; razorpay: ResolvedRazorpayCredentials }
  | { gateway: 'paypal'; paypal: ResolvedPaypalCredentials }
> {
  const row = await getPaymentGatewaySettingsRow(db);
  const gateway = resolveActiveGateway(row);
  if (gateway === 'stripe') {
    return { gateway, stripe: resolveStripeCredentials(row) };
  }
  if (gateway === 'paypal') {
    return { gateway, paypal: resolvePaypalCredentials(row) };
  }
  return { gateway, razorpay: resolveRazorpayCredentials(row) };
}
