// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Plain-fetch Stripe, RazorPay, and PayPal clients for minting/listing
 * prices/plans from the Admin Settings -> Payment Gateways panel and the
 * Admin Plans panel.
 *
 * Deliberately not an official SDK for any of the three: apps/web has no
 * Node package for any gateway today (all gateway SDK usage lives in the
 * Deno Edge Functions -- checkout/index.ts, _shared/razorpay.ts), and this
 * codebase's every other admin mutation (see apps/web/app/api/admin/*)
 * already runs as a plain Next.js route handler with a service-role
 * Supabase client, not an Edge Function. All three gateways' REST APIs are
 * simple enough over fetch that adding a new npm dependency isn't worth it
 * just for this.
 *
 * Every function here takes its credentials as an explicit parameter
 * rather than reading env vars internally -- callers resolve credentials
 * once via gateway-settings.ts (admin-configured DB row, falling back to
 * env vars) and pass the result down. This is what lets an admin's
 * Settings -> Payment Gateways entry actually take effect without a
 * redeploy.
 */

// ─── Stripe ─────────────────────────────────────────────────────────────────

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

export class StripeAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'StripeAdminApiError';
  }
}

/** Recursively flattens an object into Stripe's bracket-notation form-encoded params. */
function toStripeFormParams(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      pairs.push(...toStripeFormParams(value as Record<string, unknown>, paramKey));
    } else {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

async function stripeFetch<T>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const params = body ? new URLSearchParams(toStripeFormParams(body)) : undefined;
  const url = method === 'GET' && body ? `${STRIPE_BASE_URL}${path}?${new URLSearchParams(toStripeFormParams(body)).toString()}` : `${STRIPE_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? params?.toString() : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { error?: { message?: string } })?.error?.message ?? `Stripe API error (${res.status})`;
    throw new StripeAdminApiError(description, res.status, json);
  }
  return json as T;
}

export interface StripePrice {
  id: string;
  product: string;
  unit_amount: number;
  currency: string;
  active?: boolean;
  [key: string]: unknown;
}

/**
 * Mint a new Stripe Price (and a fresh backing Product) for a plan tier.
 *
 * Stripe Prices are immutable -- there is no "update the amount" call. A
 * price change always means creating a new Price object and pointing the
 * plan at its id; an existing subscriber's own subscription keeps whatever
 * price id it was created with regardless (Stripe does not auto-follow a
 * Product's "current" price), so this never disturbs anyone already
 * subscribed. Creating a fresh Product alongside each Price (rather than
 * reusing one Product per tier) is the simplest correct option and mirrors
 * what a `product_data` inline price-creation call does -- the tradeoff is
 * a new Product object per edit in the Stripe dashboard, which is cosmetic
 * clutter, not a functional issue.
 */
export async function createStripePrice(params: {
  secretKey: string;
  displayName: string;
  unitAmountCents: number;
  currency?: string;
}): Promise<StripePrice> {
  return stripeFetch<StripePrice>(params.secretKey, 'POST', '/prices', {
    unit_amount: params.unitAmountCents,
    currency: params.currency ?? 'usd',
    recurring: { interval: 'month' },
    product_data: { name: params.displayName },
  });
}

/** List active recurring Stripe Prices -- used by the "fetch plans from gateway" panel. */
export async function listStripePrices(secretKey: string, limit = 50): Promise<StripePrice[]> {
  const result = await stripeFetch<{ data: StripePrice[] }>(secretKey, 'GET', '/prices', {
    active: true,
    limit,
    'expand[]': 'data.product',
  });
  return result.data ?? [];
}

// ─── RazorPay ───────────────────────────────────────────────────────────────

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

export class RazorpayAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'RazorpayAdminApiError';
  }
}

async function razorpayFetch<T>(
  keyId: string,
  keySecret: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { error?: { description?: string } })?.error?.description ?? `RazorPay API error (${res.status})`;
    throw new RazorpayAdminApiError(description, res.status, json);
  }
  return json as T;
}

export interface RazorpayPlan {
  id: string;
  period: string;
  interval: number;
  item: { amount: number; currency: string; name: string };
  [key: string]: unknown;
}

/**
 * Create a new RazorPay Plan for a tier. RazorPay Plans are immutable the
 * same way Stripe Prices are (no update-amount call) -- same rule, same
 * reason: never mutate a plan an existing subscription is attached to.
 *
 * amountInrPaise is the price in INR paise, computed by the caller from the
 * plan's price_usd_cents at the admin-configured exchange rate (see
 * supabase/functions/_shared/currency.ts's getInrToUsdRate for the same
 * conversion checkout/webhook-razorpay use) -- this function does not
 * itself do currency conversion.
 */
export async function createRazorpayPlan(params: {
  keyId: string;
  keySecret: string;
  displayName: string;
  amountInrPaise: number;
}): Promise<RazorpayPlan> {
  return razorpayFetch<RazorpayPlan>(params.keyId, params.keySecret, 'POST', '/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: params.displayName,
      amount: params.amountInrPaise,
      currency: 'INR',
    },
  });
}

/** List RazorPay plans -- used by the "fetch plans from gateway" panel. */
export async function listRazorpayPlans(keyId: string, keySecret: string, count = 50): Promise<RazorpayPlan[]> {
  const result = await razorpayFetch<{ items: RazorpayPlan[] }>(
    keyId,
    keySecret,
    'GET',
    `/plans?count=${count}`,
  );
  return result.items ?? [];
}

// ─── PayPal ─────────────────────────────────────────────────────────────────

export class PaypalAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'PaypalAdminApiError';
  }
}

function paypalBaseUrl(mode: 'live' | 'sandbox'): string {
  return mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

/**
 * PayPal's REST API authenticates via a short-lived OAuth2 access token
 * (client_credentials grant), unlike Stripe's/RazorPay's static Basic Auth
 * secret -- every call below fetches a fresh token first. PayPal tokens are
 * valid ~8-9 hours, but these are low-frequency admin actions (creating a
 * handful of plans, occasionally listing them), so there's no caching here;
 * simplicity over an unneeded optimization.
 */
async function getPaypalAccessToken(clientId: string, clientSecret: string, mode: 'live' | 'sandbox'): Promise<string> {
  const res = await fetch(`${paypalBaseUrl(mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { error_description?: string })?.error_description ?? `PayPal auth error (${res.status})`;
    throw new PaypalAdminApiError(description, res.status, json);
  }
  const token = (json as { access_token?: string }).access_token;
  if (!token) throw new PaypalAdminApiError('PayPal did not return an access token', res.status, json);
  return token;
}

async function paypalFetch<T>(
  creds: { clientId: string; clientSecret: string; mode: 'live' | 'sandbox' },
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getPaypalAccessToken(creds.clientId, creds.clientSecret, creds.mode);
  const res = await fetch(`${paypalBaseUrl(creds.mode)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { message?: string; details?: Array<{ description?: string }> })?.details?.[0]?.description
      ?? (json as { message?: string })?.message
      ?? `PayPal API error (${res.status})`;
    throw new PaypalAdminApiError(description, res.status, json);
  }
  return json as T;
}

export interface PaypalPlan {
  id: string;
  product_id?: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

/**
 * Create a new PayPal Billing Plan for a tier. Unlike Stripe (a Price can
 * inline-create its Product) or RazorPay (a Plan bundles amount+item
 * together), PayPal requires the backing Product to exist as its own
 * object first -- so this mints a fresh Catalog Product, then a Billing
 * Plan pointing at it, mirroring createStripePrice's "new Product per
 * mint" choice for the same reason: PayPal Plans are immutable once
 * created (no update-price call), so a price change always means minting a
 * new Plan rather than mutating one a subscriber may already be on.
 */
export async function createPaypalPlan(params: {
  clientId: string;
  clientSecret: string;
  mode: 'live' | 'sandbox';
  displayName: string;
  unitAmountCents: number;
  currency?: string;
}): Promise<PaypalPlan> {
  const creds = { clientId: params.clientId, clientSecret: params.clientSecret, mode: params.mode };
  const product = await paypalFetch<{ id: string }>(creds, 'POST', '/v1/catalogs/products', {
    name: params.displayName,
    type: 'SERVICE',
    category: 'SOFTWARE',
  });

  const currency = (params.currency ?? 'USD').toUpperCase();
  const value = (params.unitAmountCents / 100).toFixed(2);
  return paypalFetch<PaypalPlan>(creds, 'POST', '/v1/billing/plans', {
    product_id: product.id,
    name: params.displayName,
    billing_cycles: [
      {
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // 0 = bills indefinitely until cancelled
        pricing_scheme: { fixed_price: { value, currency_code: currency } },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
  });
}

/** List active PayPal billing plans -- used by the "fetch plans from gateway" panel. */
export async function listPaypalPlans(
  clientId: string,
  clientSecret: string,
  mode: 'live' | 'sandbox',
  pageSize = 50,
): Promise<PaypalPlan[]> {
  const result = await paypalFetch<{ plans: PaypalPlan[] }>(
    { clientId, clientSecret, mode },
    'GET',
    `/v1/billing/plans?page_size=${pageSize}&total_required=false`,
  );
  return result.plans ?? [];
}
