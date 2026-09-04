// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Plain-fetch Stripe and RazorPay clients for minting new prices/plans from
 * the Admin Plans panel.
 *
 * Deliberately not the `stripe` npm package: apps/web has no Node package
 * for either gateway today (all gateway SDK usage lives in the Deno Edge
 * Functions -- checkout/index.ts, _shared/razorpay.ts), and this codebase's
 * every other admin mutation (see apps/web/app/api/admin/*) already runs as
 * a plain Next.js route handler with a service-role Supabase client, not an
 * Edge Function. Both gateways' REST APIs are simple enough over fetch that
 * adding a new npm dependency (or a new admin-authenticated Edge Function,
 * with its own separate secret-configuration surface -- see
 * _shared/razorpay.ts's own comment on that duplication) isn't worth it
 * just for this. Mirrors _shared/razorpay.ts's fetch-with-Basic-Auth
 * pattern for RazorPay; Stripe's REST API takes the same shape (Basic Auth,
 * form-encoded bodies) so the same style applies there too.
 */

// ─── Stripe ─────────────────────────────────────────────────────────────────

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

export class StripeAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'StripeAdminApiError';
  }
}

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  return key;
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

async function stripeFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const secretKey = getStripeSecretKey();
  const params = new URLSearchParams(toStripeFormParams(body));
  const res = await fetch(`${STRIPE_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
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
  displayName: string;
  unitAmountCents: number;
  currency?: string;
}): Promise<StripePrice> {
  return stripeFetch<StripePrice>('/prices', {
    unit_amount: params.unitAmountCents,
    currency: params.currency ?? 'usd',
    recurring: { interval: 'month' },
    product_data: { name: params.displayName },
  });
}

// ─── RazorPay ───────────────────────────────────────────────────────────────

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

export class RazorpayAdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'RazorpayAdminApiError';
  }
}

function getRazorpayCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_API_KEY;
  const keySecret = process.env.RAZORPAY_API_SECRET;
  if (!keyId || !keySecret) throw new Error('Missing RAZORPAY_API_KEY or RAZORPAY_API_SECRET environment variable');
  return { keyId, keySecret };
}

async function razorpayFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { keyId, keySecret } = getRazorpayCredentials();
  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
  displayName: string;
  amountInrPaise: number;
}): Promise<RazorpayPlan> {
  return razorpayFetch<RazorpayPlan>('/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: params.displayName,
      amount: params.amountInrPaise,
      currency: 'INR',
    },
  });
}
