// Copyright 2026 Vantly UGC contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin RazorPay REST client for Edge Functions.
 *
 * RazorPay has no official Deno SDK (unlike Stripe, used elsewhere in this
 * codebase via https://esm.sh/stripe@17?target=deno), so this talks to
 * https://api.razorpay.com/v1 directly over fetch with HTTP Basic Auth
 * (key_id:key_secret) -- the same approach AutoGPT's platform uses for its
 * RazorPay integration.
 *
 * Scope: subscription create/cancel (recurring billing), one-time orders
 * (PAYG top-ups), invoice listing (billing-history parity), and webhook
 * signature verification. Deliberately does NOT include the ₹1
 * payment-method-verification/tokenization flow some other platforms build
 * on top of RazorPay -- out of scope for this integration.
 */

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

/**
 * Read RazorPay API credentials from env. Throws if either is missing --
 * callers should catch this and surface a 500 "not configured" response
 * rather than let it bubble as an unhandled error.
 */
export function getRazorpayCredentials(): RazorpayCredentials {
  const keyId = Deno.env.get("RAZORPAY_API_KEY");
  const keySecret = Deno.env.get("RAZORPAY_API_SECRET");
  if (!keyId || !keySecret) {
    throw new Error(
      "Missing RAZORPAY_API_KEY or RAZORPAY_API_SECRET environment variable",
    );
  }
  return { keyId, keySecret };
}

/** Whether RazorPay credentials are present (does not call the API). */
export function isRazorpayConfigured(): boolean {
  return !!(Deno.env.get("RAZORPAY_API_KEY") && Deno.env.get("RAZORPAY_API_SECRET"));
}

/**
 * Which gateway this deployment is configured to use. Mirrors AutoGPT's
 * platform's PAYMENT_GATEWAY setting -- a deploy-time choice (Edge Function
 * secret), not a per-request or per-user choice.
 *
 * Defaults to "razorpay" when PAYMENT_GATEWAY is unset, matching AutoGPT's
 * own default (2026-09 decision). IMPORTANT: this is a behavior change for
 * any deployment that was relying on the unset-default previously being
 * "stripe" -- a production deployment that has never explicitly set
 * PAYMENT_GATEWAY and does not also set RAZORPAY_API_KEY/RAZORPAY_API_SECRET
 * will start failing checkout/webhook requests (missing-credentials errors)
 * the moment this code deploys. Set PAYMENT_GATEWAY=stripe explicitly
 * (Supabase Edge Function secret) to keep an existing Stripe deployment
 * working unchanged -- do this BEFORE deploying if Stripe is live today.
 * apps/web's own PAYMENT_GATEWAY (a separate, non-secret env var on the web
 * container -- see apps/web/app/layout.tsx) must be set to the SAME value,
 * or the UI's displayed currency/billing-enabled state will disagree with
 * what checkout actually does.
 */
export function getActivePaymentGateway(): "stripe" | "razorpay" {
  const raw = (Deno.env.get("PAYMENT_GATEWAY") ?? "razorpay").trim().toLowerCase();
  return raw === "stripe" ? "stripe" : "razorpay";
}

// ─── Low-level fetch wrapper ────────────────────────────────────────────────

class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

async function razorpayFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> },
): Promise<T> {
  const { keyId, keySecret } = getRazorpayCredentials();
  const basicAuth = btoa(`${keyId}:${keySecret}`);

  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const description =
      (json as { error?: { description?: string } })?.error?.description ??
      `RazorPay API error (${res.status})`;
    throw new RazorpayApiError(description, res.status, json);
  }

  return json as T;
}

export { RazorpayApiError };

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
 * Create a RazorPay Subscription. `total_count` is required by RazorPay's
 * API (no "forever" subscriptions) -- 120 monthly cycles (~10 years) is
 * used everywhere here, matching AutoGPT's platform's own choice, since
 * Vantly's plans are monthly-only today.
 *
 * `notes` should carry { user_id, plan_tier } so the webhook can resolve
 * who this is for without a DB round-trip (RazorPay echoes `notes` back on
 * every subscription.* webhook event unchanged).
 */
export async function createSubscription(params: {
  planId: string;
  totalCount?: number;
  customerNotify?: boolean;
  notes: Record<string, string>;
}): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: {
      plan_id: params.planId,
      total_count: params.totalCount ?? 120,
      customer_notify: params.customerNotify ?? 1,
      notes: params.notes,
    },
  });
}

/**
 * Cancel a RazorPay subscription.
 *
 * `cancelAtCycleEnd: true` lets the current billing cycle finish (matches
 * Stripe's cancel_at_period_end semantics used elsewhere in this app);
 * RazorPay's API param for this is `cancel_at_cycle_end` (0/1).
 *
 * RazorPay returns 400 for a subscription that's already
 * cancelled/completed/expired -- callers should treat that as a successful
 * no-op (see webhook-razorpay's docs) rather than surface it as a failure,
 * since the end state the caller wants is already true.
 */
export async function cancelSubscription(
  subscriptionId: string,
  cancelAtCycleEnd: boolean,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(
    `/subscriptions/${subscriptionId}/cancel`,
    {
      method: "POST",
      body: { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 },
    },
  );
}

export async function fetchSubscription(
  subscriptionId: string,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(`/subscriptions/${subscriptionId}`, {
    method: "GET",
  });
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

/**
 * Create a RazorPay Order for a one-time payment (PAYG credit top-up).
 * Paid client-side via RazorPay Checkout.js against this order id; the
 * resulting payment is confirmed server-side by the order.paid /
 * payment.captured webhook, never trusted from the client redirect alone.
 */
export async function createOrder(params: {
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  return razorpayFetch<RazorpayOrder>("/orders", {
    method: "POST",
    body: {
      amount: params.amountPaise,
      currency: params.currency ?? "INR",
      receipt: params.receipt,
      notes: params.notes,
    },
  });
}

// ─── Invoices (billing-history parity) ─────────────────────────────────────

export interface RazorpayInvoice {
  id: string;
  date: number; // unix seconds
  amount_paid: number; // paise
  currency: string;
  status: string;
  short_url: string | null;
  description?: string;
  [key: string]: unknown;
}

/** List invoices generated for a subscription (most recent first). */
export async function listSubscriptionInvoices(
  subscriptionId: string,
  limit = 20,
): Promise<RazorpayInvoice[]> {
  const result = await razorpayFetch<{ items: RazorpayInvoice[] }>(
    `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&count=${limit}`,
    { method: "GET" },
  );
  return result.items ?? [];
}

// ─── Webhook signature verification ────────────────────────────────────────

/**
 * Verify a RazorPay webhook's X-Razorpay-Signature header:
 * HMAC-SHA256(rawBody, webhook_secret) must equal the header, hex-encoded.
 *
 * Fails CLOSED: if the secret isn't configured, this returns false rather
 * than skipping verification -- mirrors webhook-stripe's signature check
 * and the fail-closed pattern AutoGPT's platform's own RazorPay webhook
 * documents as a hard requirement (an unconfigured secret must never mean
 * "accept anything").
 */
export async function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret || !signatureHeader) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expectedSignature, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
