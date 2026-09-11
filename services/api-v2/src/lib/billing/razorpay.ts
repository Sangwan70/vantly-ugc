// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * RazorPay REST client for live checkout/webhooks in api-v2, ported from
 * supabase/functions/_shared/razorpay.ts (a Supabase Edge Function -- see
 * routes/v1/billing/checkout.ts's file comment for why this exists here
 * instead). Talks to https://api.razorpay.com/v1 directly over fetch with
 * HTTP Basic Auth (key_id:key_secret), same as the Deno original -- no
 * official RazorPay Node SDK is added here either, for consistency and to
 * avoid a second, differently-shaped client for the same API.
 *
 * Credentials are passed in explicitly (resolved by gateway-settings.ts
 * from the admin-configured payment_gateway_settings row, falling back to
 * RAZORPAY_API_KEY/SECRET env vars) rather than read from env internally,
 * unlike the Deno original -- see gateway-settings.ts's doc comment.
 */

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

export class RazorpayApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

async function razorpayFetch<T>(
  creds: { keyId: string; keySecret: string },
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
): Promise<T> {
  const basicAuth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { error?: { description?: string } })?.error?.description ?? `RazorPay API error (${res.status})`;
    throw new RazorpayApiError(description, res.status, json);
  }
  return json as T;
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export interface RazorpaySubscription {
  id: string;
  status: string;
  short_url: string;
  plan_id: string;
  customer_id?: string;
  notes?: Record<string, string>;
  current_start?: number;
  current_end?: number;
  [key: string]: unknown;
}

/**
 * total_count: 120 monthly cycles (~10 years) -- RazorPay requires a finite
 * count, no "forever" subscriptions.
 *
 * startAt (unix seconds, optional): RazorPay's native delayed-billing
 * mechanism -- the customer authorizes/sets up the payment mandate now
 * (subscription status starts at 'created', then 'authenticated' once
 * they complete that step), but the first real charge is deferred until
 * this timestamp (subscription.charged/activated fire then). Used for
 * trial_months coupons; omitted, billing starts immediately as before.
 */
export async function createSubscription(
  creds: { keyId: string; keySecret: string },
  params: { planId: string; totalCount?: number; customerNotify?: boolean; startAt?: number; notes: Record<string, string> },
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(creds, '/subscriptions', {
    method: 'POST',
    body: {
      plan_id: params.planId,
      total_count: params.totalCount ?? 120,
      customer_notify: params.customerNotify ?? 1,
      ...(params.startAt ? { start_at: params.startAt } : {}),
      notes: params.notes,
    },
  });
}

/** RazorPay returns 400 for an already-cancelled/completed/expired subscription -- callers should treat that as a no-op. */
export async function cancelSubscription(
  creds: { keyId: string; keySecret: string },
  subscriptionId: string,
  cancelAtCycleEnd: boolean,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(creds, `/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 },
  });
}

export async function fetchSubscription(
  creds: { keyId: string; keySecret: string },
  subscriptionId: string,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(creds, `/subscriptions/${subscriptionId}`, { method: 'GET' });
}

// ─── Orders (one-time payments, used for PAYG) ─────────────────────────────

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  notes?: Record<string, string>;
  [key: string]: unknown;
}

export async function createOrder(
  creds: { keyId: string; keySecret: string },
  params: { amountPaise: number; currency?: string; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>(creds, '/orders', {
    method: 'POST',
    body: {
      amount: params.amountPaise,
      currency: params.currency ?? 'INR',
      receipt: params.receipt,
      notes: params.notes,
    },
  });
}

// ─── Invoices (billing-history parity) ─────────────────────────────────────

export interface RazorpayInvoice {
  id: string;
  date: number;
  amount_paid: number;
  currency: string;
  status: string;
  short_url: string | null;
  description?: string;
  [key: string]: unknown;
}

export async function listSubscriptionInvoices(
  creds: { keyId: string; keySecret: string },
  subscriptionId: string,
  limit = 20,
): Promise<RazorpayInvoice[]> {
  const result = await razorpayFetch<{ items: RazorpayInvoice[] }>(
    creds,
    `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&count=${limit}`,
    { method: 'GET' },
  );
  return result.items ?? [];
}

// ─── Webhook signature verification ────────────────────────────────────────

/**
 * Verify a RazorPay webhook's X-Razorpay-Signature header:
 * HMAC-SHA256(rawBody, webhook_secret) must equal the header, hex-encoded.
 * Fails CLOSED: if the secret isn't configured, returns false rather than
 * skipping verification.
 */
export async function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqualStr(expectedSignature, signatureHeader);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
