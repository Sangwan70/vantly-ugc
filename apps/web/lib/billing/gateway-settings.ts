// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolves the admin-configured payment_gateway_settings row (see
 * 20260907120000_payment_gateway_settings.sql) into the actual credentials
 * each gateway client should use: a DB-stored value always wins over the
 * matching env var, so an admin who fills in Settings -> Payment Gateways
 * takes over from whatever was set at deploy time without needing a
 * redeploy. `source` is surfaced back to the admin UI (GET
 * /api/admin/settings/payment-gateways) so it can show "from database" /
 * "from environment" / "not configured" per gateway, mirroring the mailer
 * settings route's resend_api_key_source pattern.
 *
 * PayPal has no env-var fallback today (no PAYPAL_CLIENT_ID/SECRET existed
 * anywhere in this codebase before this feature) -- env is still checked
 * for forward-compatibility with a self-hoster who sets one at deploy time.
 */

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
  admin: SupabaseClient,
): Promise<PaymentGatewaySettingsRow> {
  const { data, error } = await admin
    .from('payment_gateway_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_ROW, ...(data as Partial<PaymentGatewaySettingsRow> | null ?? {}) };
}

/**
 * Resolve which gateway the ADMIN-FACING surfaces (billing/currency display
 * in app/layout.tsx, Settings -> Payment Gateways) should treat as active.
 * DB-first, env-fallback -- mirrors
 * services/api-v2/src/lib/billing/gateway-settings.ts's resolveActiveGateway
 * exactly (same precedence, same default) so the UI never disagrees with
 * what live checkout actually uses.
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
export interface ResolvedPaypalCredentials {
  clientId: string | null;
  clientSecret: string | null;
  mode: 'live' | 'sandbox';
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
