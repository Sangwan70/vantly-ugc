// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Hand-rolled PayPal REST client for api-v2's billing routes.
 *
 * Same reasoning as stripe.ts/razorpay.ts for not using an official SDK:
 * this workspace's connected folder is a FUSE mount, and `pnpm add`
 * reliably fails partway through on it (ERR_PNPM_EPERM) -- new
 * dependencies cannot be installed here. This mirrors the OAuth-token +
 * plain-fetch pattern already proven in
 * apps/web/lib/billing/gateway-admin.ts's PayPal section (used there for
 * admin-side Product/Plan minting) -- same base URLs, same token fetch,
 * just extended here with the live-checkout surface: Orders (PAYG),
 * Subscriptions (recurring plans), and webhook signature verification.
 *
 * Scope: create/capture/get order, create/get/cancel subscription, list
 * subscription transactions (billing-history parity), webhook signature
 * verification via PayPal's own verify-webhook-signature endpoint (the
 * officially recommended approach -- avoids hand-rolling X.509 certificate
 * chain validation and RSA signature verification ourselves).
 */

const PAYPAL_BASE_URLS: Record<'live' | 'sandbox', string> = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
};

export interface PaypalCredentials {
  clientId: string;
  clientSecret: string;
  mode: 'live' | 'sandbox';
}

export class PaypalApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'PaypalApiError';
  }
}

// ─── OAuth2 access token (cached in-memory; PayPal tokens last ~8-9h) ──────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(creds: PaypalCredentials): Promise<string> {
  const cacheKey = `${creds.mode}:${creds.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const res = await fetch(`${PAYPAL_BASE_URLS[creds.mode]}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = (json as { error_description?: string })?.error_description ?? `PayPal auth error (${res.status})`;
    throw new PaypalApiError(description, res.status, json);
  }
  const token = (json as { access_token?: string }).access_token;
  const expiresIn = (json as { expires_in?: number }).expires_in ?? 3600;
  if (!token) throw new PaypalApiError('PayPal did not return an access token', res.status, json);

  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

async function paypalFetch<T>(
  creds: PaypalCredentials,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const token = await getAccessToken(creds);
  const res = await fetch(`${PAYPAL_BASE_URLS[creds.mode]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const description =
      (json as { message?: string; details?: Array<{ description?: string }> })?.details?.[0]?.description ??
      (json as { message?: string })?.message ??
      `PayPal API error (${res.status})`;
    throw new PaypalApiError(description, res.status, json);
  }
  return json as T;
}

interface PaypalLink {
  href: string;
  rel: string;
  method?: string;
}

/**
 * PayPal's docs disagree across API revisions about whether the
 * buyer-approval link's `rel` is "approve" or "payer-action" (both are
 * documented, for different order states) -- check both rather than
 * guessing wrong and breaking checkout.
 */
function findApprovalLink(links: PaypalLink[] | undefined): string | null {
  if (!links) return null;
  const link = links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return link?.href ?? null;
}

// ─── Orders (one-time payments, used for PAYG) ─────────────────────────────

export interface PaypalOrder {
  id: string;
  status: string;
  links?: PaypalLink[];
  purchase_units?: Array<{
    custom_id?: string;
    reference_id?: string;
    payments?: { captures?: Array<{ id: string; status: string; amount?: { currency_code: string; value: string } }> };
  }>;
  [key: string]: unknown;
}

/**
 * Create an Order with intent=CAPTURE. The buyer must approve it (redirect
 * to the returned approvalUrl); capturing happens as a separate step --
 * see routes/v1/billing/webhook-paypal.ts's CHECKOUT.ORDER.APPROVED
 * handler, which captures automatically once PayPal notifies us the buyer
 * approved (more reliable than waiting on the browser to complete the
 * return_url redirect).
 */
export async function createOrder(
  creds: PaypalCredentials,
  params: { amountUsd: number; customId: string; referenceId?: string; returnUrl: string; cancelUrl: string; description?: string },
): Promise<{ id: string; approvalUrl: string | null }> {
  const order = await paypalFetch<PaypalOrder>(
    creds,
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.referenceId,
          custom_id: params.customId,
          description: params.description,
          amount: { currency_code: 'USD', value: params.amountUsd.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: params.returnUrl,
            cancel_url: params.cancelUrl,
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    },
    { 'PayPal-Request-Id': params.customId },
  );
  return { id: order.id, approvalUrl: findApprovalLink(order.links) };
}

export function getOrder(creds: PaypalCredentials, orderId: string): Promise<PaypalOrder> {
  return paypalFetch<PaypalOrder>(creds, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Capture a buyer-approved order. Idempotent on PayPal's side for a given order id + intent. */
export function captureOrder(creds: PaypalCredentials, orderId: string): Promise<PaypalOrder> {
  return paypalFetch<PaypalOrder>(
    creds,
    'POST',
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    undefined,
    { 'PayPal-Request-Id': `capture-${orderId}` },
  );
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export interface PaypalSubscription {
  id: string;
  status: string;
  plan_id?: string;
  custom_id?: string;
  links?: PaypalLink[];
  billing_info?: { last_payment?: { amount?: { currency_code: string; value: string } } };
  [key: string]: unknown;
}

export async function createSubscription(
  creds: PaypalCredentials,
  params: { planId: string; customId: string; returnUrl: string; cancelUrl: string },
): Promise<{ id: string; approvalUrl: string | null }> {
  const subscription = await paypalFetch<PaypalSubscription>(
    creds,
    'POST',
    '/v1/billing/subscriptions',
    {
      plan_id: params.planId,
      custom_id: params.customId,
      application_context: {
        brand_name: 'Vantly',
        user_action: 'SUBSCRIBE_NOW',
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    },
    { 'PayPal-Request-Id': params.customId },
  );
  return { id: subscription.id, approvalUrl: findApprovalLink(subscription.links) };
}

export function getSubscription(creds: PaypalCredentials, subscriptionId: string): Promise<PaypalSubscription> {
  return paypalFetch<PaypalSubscription>(creds, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/** PayPal returns 422 for an already-cancelled subscription -- callers should treat that as a no-op. */
export function cancelSubscription(creds: PaypalCredentials, subscriptionId: string, reason: string): Promise<void> {
  return paypalFetch<void>(creds, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { reason });
}

export interface PaypalTransaction {
  id: string;
  status: string;
  time: string;
  amount_with_breakdown?: { gross_amount?: { currency_code: string; value: string } };
  [key: string]: unknown;
}

/** List a subscription's billing transactions (billing-history parity). PayPal requires an explicit time window. */
export async function listSubscriptionTransactions(
  creds: PaypalCredentials,
  subscriptionId: string,
  startTime: string,
  endTime: string,
): Promise<PaypalTransaction[]> {
  const result = await paypalFetch<{ transactions?: PaypalTransaction[] }>(
    creds,
    'GET',
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`,
  );
  return result.transactions ?? [];
}

// ─── Webhook signature verification ─────────────────────────────────────────

export interface PaypalWebhookEvent {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaypalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

/**
 * Verify a PayPal webhook via PayPal's own verify-webhook-signature API
 * (the officially documented approach) rather than validating the X.509
 * certificate chain and RSA signature locally -- one extra API round trip
 * per webhook delivery, but far less surface for us to get wrong.
 */
export async function verifyPaypalWebhookSignature(
  creds: PaypalCredentials,
  headers: PaypalWebhookHeaders,
  webhookId: string,
  webhookEvent: unknown,
): Promise<boolean> {
  const result = await paypalFetch<{ verification_status?: string }>(
    creds,
    'POST',
    '/v1/notifications/verify-webhook-signature',
    {
      transmission_id: headers.transmissionId,
      transmission_time: headers.transmissionTime,
      cert_url: headers.certUrl,
      auth_algo: headers.authAlgo,
      transmission_sig: headers.transmissionSig,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    },
  );
  return result.verification_status === 'SUCCESS';
}
