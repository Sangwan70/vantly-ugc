/**
 * Edge Function: cancel-subscription
 *
 * Cancels the user's Stripe subscription at period end.
 * The user keeps access until their current billing period expires.
 *
 * Route:
 *   POST /functions/v1/cancel-subscription
 *
 * Response (200):
 *   { "canceled": true, "cancel_at": "2026-05-02T..." }
 */

import { corsResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { checkRateLimit, getRateLimitHeaders } from "../_shared/rate-limit.ts";
import { getCorsHeaders, getSecurityHeaders } from "../_shared/security-headers.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";
import { cancelSubscription as cancelRazorpaySubscription } from "../_shared/razorpay.ts";

function getStripe(): Stripe {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable");
  }
  return new Stripe(secretKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

async function handleCancel(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin") ?? "";
  const corsRes = (body: unknown, init?: ResponseInit) =>
    corsResponse(body, init, origin);

  // 1. Verify authentication
  const { user, error: authError } = await verifyAuth(req);
  if (authError || !user) {
    return corsRes(
      { error: "unauthorized", error_description: authError ?? "Authentication required" },
      { status: 401 },
    );
  }

  const db = supabaseAdmin();

  // 2. Rate limit
  const rateLimitResult = await checkRateLimit(user.id, "cancel-subscription", db);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: "rate_limit_exceeded",
        retry_after: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...getRateLimitHeaders(rateLimitResult),
          ...getCorsHeaders(origin),
          ...getSecurityHeaders(),
        },
      },
    );
  }

  // 3. Look up the user's most recent subscription row -- branch by which
  // gateway it belongs to (payment_gateway defaults to 'stripe' for every
  // pre-existing row, so this is backward compatible with no data migration).
  const { data: subscription, error: subError } = await db
    .from("subscriptions")
    .select("payment_gateway, stripe_customer_id, razorpay_subscription_id")
    .eq("user_id", user.id)
    .or("stripe_customer_id.not.is.null,razorpay_subscription_id.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError || !subscription) {
    return corsRes(
      { error: "no_subscription", error_description: "No active subscription found" },
      { status: 400 },
    );
  }

  if (subscription.payment_gateway === "razorpay") {
    return await handleCancelRazorpay(db, user.id, subscription.razorpay_subscription_id, corsRes);
  }

  return await handleCancelStripe(db, user.id, subscription.stripe_customer_id, corsRes);
}

async function handleCancelStripe(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  stripeCustomerId: string | null,
  corsRes: (body: unknown, init?: ResponseInit) => Response,
): Promise<Response> {
  if (!stripeCustomerId) {
    return corsRes(
      { error: "no_subscription", error_description: "No active subscription found" },
      { status: 400 },
    );
  }

  // Find the active Stripe subscription
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "active",
    limit: 1,
  });

  let stripeSub = subs.data[0];
  if (!stripeSub) {
    const trialSubs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "trialing",
      limit: 1,
    });
    stripeSub = trialSubs.data[0];
  }

  if (!stripeSub) {
    return corsRes(
      { error: "no_subscription", error_description: "No active Stripe subscription found" },
      { status: 400 },
    );
  }

  // Cancel at period end (user keeps access until end of billing cycle)
  const updated = await stripe.subscriptions.update(stripeSub.id, {
    cancel_at_period_end: true,
  });

  const periodEndIso = new Date((updated.current_period_end ?? 0) * 1000).toISOString();

  // Update our DB — flag as cancel-pending, keep status "active"
  await db
    .from("subscriptions")
    .update({
      cancel_at_period_end: true,
      current_period_end: periodEndIso,
    })
    .eq("user_id", userId);

  return corsRes({
    canceled: true,
    cancel_at: periodEndIso,
  });
}

/**
 * Cancel a RazorPay subscription. `cancelAtCycleEnd: true` mirrors the
 * Stripe path's cancel_at_period_end -- the user keeps access until the
 * current billing cycle ends. RazorPay returns a 400 API error for a
 * subscription that's already cancelled/completed/expired; that's treated
 * as a successful no-op here (the caller's desired end state -- "not
 * billing this user again" -- is already true), not surfaced as a failure.
 */
async function handleCancelRazorpay(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  razorpaySubscriptionId: string | null,
  corsRes: (body: unknown, init?: ResponseInit) => Response,
): Promise<Response> {
  if (!razorpaySubscriptionId) {
    return corsRes(
      { error: "no_subscription", error_description: "No active subscription found" },
      { status: 400 },
    );
  }

  let periodEndIso: string | null = null;
  try {
    const updated = await cancelRazorpaySubscription(razorpaySubscriptionId, true);
    periodEndIso = updated.current_end ? new Date((updated.current_end as number) * 1000).toISOString() : null;
  } catch (err) {
    const alreadyEnded = err instanceof Error && /already|cancel|complet|expir/i.test(err.message);
    if (!alreadyEnded) {
      console.error("RazorPay cancel failed:", err);
      return corsRes(
        {
          error: "razorpay_error",
          error_description: err instanceof Error ? err.message : "Failed to cancel subscription",
        },
        { status: 502 },
      );
    }
    console.warn(
      `RazorPay subscription ${razorpaySubscriptionId} was already cancelled/completed -- treating as success`,
    );
  }

  const update: Record<string, unknown> = { cancel_at_period_end: true };
  if (periodEndIso) update.current_period_end = periodEndIso;

  await db.from("subscriptions").update(update).eq("user_id", userId);

  return corsRes({
    canceled: true,
    cancel_at: periodEndIso,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin") ?? "";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...getCorsHeaders(origin), ...getSecurityHeaders() },
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(origin), ...getSecurityHeaders() },
      },
    );
  }

  try {
    const response = await handleCancel(req);
    const secHeaders = getSecurityHeaders();
    for (const [key, value] of Object.entries(secHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  } catch (err) {
    console.error("Unhandled error in cancel-subscription:", err);
    return new Response(
      JSON.stringify({
        error: "server_error",
        error_description: err instanceof Error ? err.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(origin), ...getSecurityHeaders() },
      },
    );
  }
});
