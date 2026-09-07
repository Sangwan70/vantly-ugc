// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Hand-rolled Stripe REST client for api-v2's billing routes.
 *
 * Why not the official `stripe` npm SDK: this workspace's connected folder
 * is a FUSE mount, and `pnpm add` inside it reliably fails partway through
 * with ERR_PNPM_EPERM on unrelated packages' symlinks (an environment/mount
 * limitation, not a permissions bug) -- new dependencies cannot be
 * installed here at all. The original Deno Edge Functions
 * (supabase/functions/checkout, stripe-portal, billing-history,
 * cancel-subscription) used `https://esm.sh/stripe@17?target=deno`; ported
 * here as plain `fetch` calls against https://api.stripe.com/v1 with HTTP
 * Basic Auth (secret key as username, empty password) instead, mirroring
 * this same codebase's own razorpay.ts (which has never used a SDK either,
 * since RazorPay has none for Deno/Node in this style).
 *
 * Only the surface actually used by the ported checkout/stripe-portal/
 * billing-history/cancel-subscription routes is implemented: customers
 * (create/update/retrieve), subscriptions (list/create/update), checkout
 * sessions (create/list), invoices (list), billing portal sessions
 * (create). Params are passed through as plain nested objects exactly like
 * the original Stripe-SDK call sites did (`{ line_items: [...],
 * subscription_data: { metadata: {...} } }` etc) and flattened into
 * Stripe's `a[b][c]=x` / `a[0][b]=x` form-encoding by requestForm() below --
 * this keeps route code a near-literal transcription of the original
 * TypeScript instead of hand-writing a differently-shaped call for every
 * endpoint.
 *
 * Webhook signature verification (verifyStripeSignature) lives here too --
 * ported from webhook-stripe/index.ts, which never used the SDK for this
 * either (Deno's native crypto.subtle, no Stripe SDK involved).
 */

const STRIPE_BASE_URL = 'https://api.stripe.com/v1';

export class StripeApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined, readonly body: unknown) {
    super(message);
    this.name = 'StripeApiError';
  }
}

// ─── Form encoding (Stripe's API is application/x-www-form-urlencoded, ────
// ─── with PHP-style bracket nesting for objects/arrays) ────────────────────

function appendParam(pairs: string[], key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendParam(pairs, `${key}[${i}]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendParam(pairs, `${key}[${k}]`, v);
    }
    return;
  }
  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

function encodeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    appendParam(pairs, key, value);
  }
  return pairs.join('&');
}

async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const basicAuth = Buffer.from(`${secretKey}:`).toString('base64');
  let url = `${STRIPE_BASE_URL}${path}`;
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { Authorization: `Basic ${basicAuth}` },
  };

  if (method === 'GET') {
    if (params) {
      const qs = encodeForm(params);
      if (qs) url += `?${qs}`;
    }
  } else if (params) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = encodeForm(params);
  }

  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } })?.error;
    throw new StripeApiError(err?.message ?? `Stripe API error (${res.status})`, res.status, err?.code, json);
  }
  return json as T;
}

// ─── Customers ──────────────────────────────────────────────────────────────

export interface StripeCustomer {
  id: string;
  deleted?: boolean;
  invoice_settings?: { default_payment_method?: unknown };
  [key: string]: unknown;
}

export function createCustomer(
  secretKey: string,
  params: { email?: string; metadata?: Record<string, string> },
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(secretKey, 'POST', '/customers', params);
}

export function updateCustomer(
  secretKey: string,
  customerId: string,
  params: { metadata?: Record<string, string> },
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(secretKey, 'POST', `/customers/${encodeURIComponent(customerId)}`, params);
}

export function retrieveCustomer(
  secretKey: string,
  customerId: string,
  params?: { expand?: string[] },
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(secretKey, 'GET', `/customers/${encodeURIComponent(customerId)}`, params);
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export interface StripeSubscriptionItem {
  id: string;
  price: { id: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string | StripeCustomer;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  items: { data: StripeSubscriptionItem[] };
  latest_invoice?: string | StripeInvoice;
  [key: string]: unknown;
}

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}

export function listSubscriptions(
  secretKey: string,
  params: { customer: string; status?: string; limit?: number },
): Promise<StripeList<StripeSubscription>> {
  return stripeRequest<StripeList<StripeSubscription>>(secretKey, 'GET', '/subscriptions', params);
}

export function createSubscription(
  secretKey: string,
  params: Record<string, unknown>,
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(secretKey, 'POST', '/subscriptions', params);
}

export function updateSubscription(
  secretKey: string,
  subscriptionId: string,
  params: Record<string, unknown>,
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(secretKey, 'POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
}

// ─── Checkout Sessions ──────────────────────────────────────────────────────

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  client_secret?: string | null;
  status?: string;
  mode?: string;
  created?: number;
  [key: string]: unknown;
}

export function createCheckoutSession(
  secretKey: string,
  params: Record<string, unknown>,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(secretKey, 'POST', '/checkout/sessions', params);
}

export function listCheckoutSessions(
  secretKey: string,
  params: { customer: string; limit?: number },
): Promise<StripeList<StripeCheckoutSession>> {
  return stripeRequest<StripeList<StripeCheckoutSession>>(secretKey, 'GET', '/checkout/sessions', params);
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export interface StripeInvoice {
  id: string;
  created: number;
  amount_paid: number;
  currency: string;
  status: string;
  hosted_invoice_url: string | null;
  description: string | null;
  lines?: { data: Array<{ description?: string | null }> };
  payment_intent?: string | StripePaymentIntent;
  [key: string]: unknown;
}

export function listInvoices(
  secretKey: string,
  params: { customer: string; limit?: number },
): Promise<StripeList<StripeInvoice>> {
  return stripeRequest<StripeList<StripeInvoice>>(secretKey, 'GET', '/invoices', params);
}

// ─── Payment Intents (read-only here; created implicitly via subscriptions/sessions) ──

export interface StripePaymentIntent {
  id: string;
  client_secret: string | null;
  [key: string]: unknown;
}

// ─── Billing Portal ─────────────────────────────────────────────────────────

export interface StripeBillingPortalSession {
  id: string;
  url: string;
  [key: string]: unknown;
}

export function createBillingPortalSession(
  secretKey: string,
  params: { customer: string; return_url: string },
): Promise<StripeBillingPortalSession> {
  return stripeRequest<StripeBillingPortalSession>(secretKey, 'POST', '/billing_portal/sessions', params);
}

// ─── Webhook signature verification ─────────────────────────────────────────
//
// Ported verbatim (logic unchanged) from webhook-stripe/index.ts's
// verifyStripeSignature -- HMAC-SHA256 over "${timestamp}.${rawBody}" via
// Node's native crypto.subtle (global since Node 19+, confirmed available
// on this deployment's Node 22), 300s replay tolerance, constant-time
// compare. No Stripe SDK involved in the original either.

const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

/** Minimal shape of a parsed Stripe event (verified manually, not via SDK). */
export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify the Stripe webhook signature and return the parsed event.
 * Throws with a human-readable message on any failure (missing header
 * fields, stale timestamp, signature mismatch) -- callers should catch and
 * return a 400.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<StripeEvent> {
  const elements = signatureHeader.split(',');
  const pairs: Record<string, string[]> = {};
  for (const element of elements) {
    const [key, value] = element.split('=', 2);
    if (key && value) {
      (pairs[key] ??= []).push(value);
    }
  }

  const timestamp = pairs['t']?.[0];
  const signatures = pairs['v1'] ?? [];

  if (!timestamp) {
    throw new Error('Missing timestamp in Stripe-Signature header');
  }
  if (signatures.length === 0) {
    throw new Error('Missing v1 signature in Stripe-Signature header');
  }

  const eventAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(eventAge) || Math.abs(eventAge) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new Error(`Webhook timestamp outside tolerance (age: ${eventAge}s, max: ${TIMESTAMP_TOLERANCE_SECONDS}s)`);
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const matched = signatures.some((sig) => timingSafeEqual(expectedSignature, sig));
  if (!matched) {
    throw new Error('Signature verification failed: no matching v1 signature');
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON payload');
  }
  return event;
}
