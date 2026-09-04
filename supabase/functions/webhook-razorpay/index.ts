// Copyright 2026 Vantly UGC contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Edge Function: webhook-razorpay
 *
 * Receives and processes RazorPay webhook events for subscription billing
 * and PAYG credit top-ups. Parallel to webhook-stripe/index.ts (same
 * verify -> dedup -> route -> dead-letter shape), only used when this
 * deployment's PAYMENT_GATEWAY secret is set to "razorpay".
 *
 * Handled event types:
 *   - subscription.activated / subscription.charged  (grant/reset monthly credits)
 *   - subscription.cancelled / .completed / .halted  (downgrade to free, credits preserved)
 *   - order.paid / payment.captured                  (PAYG credit top-up, order-scoped only)
 *   - subscription.pending / .paused / .resumed /
 *     .updated / .authenticated                      (log-only, matches AutoGPT platform's own scope)
 *
 * Idempotency: RazorPay does not include a stable webhook-delivery id in
 * its payload (unlike Stripe's `event.id`), so the dedup key here is a
 * SHA-256 hash of the raw request body -- a genuine retry resends a
 * byte-identical body, so this is equivalent in practice to an event id.
 * The credit-granting RPCs (reset_monthly_credits / add_purchased_credits_razorpay)
 * are additionally idempotent in their own right, as defense in depth.
 */

import { supabaseAdmin } from "../_shared/supabase.ts";
import { getSecurityHeaders } from "../_shared/security-headers.ts";
import { captureEdgeError } from "../_shared/sentry.ts";
import { verifyRazorpayWebhookSignature } from "../_shared/razorpay.ts";
import { PLANS, planByRazorpayPlanId } from "../_shared/plans.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RazorpayWebhookPayload {
  event: string;
  payload: Record<string, { entity?: Record<string, unknown> } | undefined>;
}

type Db = ReturnType<typeof supabaseAdmin>;

function entity(
  payload: RazorpayWebhookPayload,
  key: string,
): Record<string, unknown> | undefined {
  return payload.payload?.[key]?.entity;
}

// ─── Idempotency ────────────────────────────────────────────────────────────

async function hashBody(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isEventAlreadyProcessed(db: Db, eventKey: string): Promise<boolean> {
  const { data, error } = await db
    .from("razorpay_webhook_events")
    .select("razorpay_event_id, processed_at")
    .eq("razorpay_event_id", eventKey)
    .maybeSingle();

  if (error) {
    console.error("Error checking RazorPay event idempotency:", error.message);
    return false; // allow processing rather than silently dropping
  }
  return !!data?.processed_at;
}

async function recordEventStart(
  db: Db,
  eventKey: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const { error } = await db.from("razorpay_webhook_events").upsert(
    { razorpay_event_id: eventKey, event_type: eventType, processed_at: null, payload },
    { onConflict: "razorpay_event_id" },
  );
  if (error) console.error("Failed to record RazorPay event start:", error.message);
}

async function recordEventComplete(db: Db, eventKey: string): Promise<void> {
  const { error } = await db
    .from("razorpay_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("razorpay_event_id", eventKey);
  if (error) console.error("Failed to mark RazorPay event complete:", error.message);
}

async function deadLetter(db: Db, payload: unknown, errorMessage: string): Promise<void> {
  const { error } = await db.from("dead_letter_webhooks").insert({
    provider_slug: "razorpay",
    payload: payload as Record<string, unknown>,
    error_message: errorMessage,
    status: "pending",
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) console.error("Failed to insert RazorPay dead letter:", error.message);
}

// ─── Subscription row resolution ───────────────────────────────────────────

interface SubRow {
  id: string;
  user_id: string;
  plan_slug: string;
}

/**
 * Look up the local subscriptions row for a RazorPay subscription. Falls
 * back to `notes.user_id` (checkout/index.ts sets this at creation time,
 * and RazorPay echoes `notes` back unchanged on every event) if the
 * razorpay_subscription_id isn't linked yet -- guards against a webhook
 * arriving before checkout's own insert commits.
 */
async function resolveSubscriptionRow(
  db: Db,
  razorpaySubscriptionId: string,
  notes: Record<string, string> | undefined,
): Promise<SubRow | null> {
  const { data: byId, error: byIdError } = await db
    .from("subscriptions")
    .select("id, user_id, plan_slug")
    .eq("razorpay_subscription_id", razorpaySubscriptionId)
    .maybeSingle();

  if (byIdError) {
    throw new Error(`subscription lookup failed: ${byIdError.message}`);
  }
  if (byId) return byId as SubRow;

  const userId = notes?.user_id;
  if (!userId) return null;

  // Backfill: link this RazorPay subscription onto the user's existing row
  // (created by checkout) if it hasn't been linked yet.
  const { data: byUser, error: byUserError } = await db
    .from("subscriptions")
    .select("id, user_id, plan_slug")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUserError) {
    throw new Error(`subscription lookup by user failed: ${byUserError.message}`);
  }
  if (!byUser) return null;

  await db
    .from("subscriptions")
    .update({ razorpay_subscription_id: razorpaySubscriptionId, payment_gateway: "razorpay" })
    .eq("id", byUser.id);

  return byUser as SubRow;
}

// ─── Event handlers ─────────────────────────────────────────────────────────

/**
 * subscription.activated / subscription.charged
 *
 * Mirrors webhook-stripe's handleInvoicePaid: first successful charge
 * initializes user_credits with the plan's monthly allowance; every
 * subsequent charge (renewal) resets it via the same reset_monthly_credits
 * RPC Stripe's path uses (unused credits do not roll over, regardless of
 * gateway).
 */
async function handleSubscriptionActivatedOrCharged(
  db: Db,
  sub: Record<string, unknown>,
): Promise<void> {
  const razorpaySubscriptionId = sub.id as string;
  const notes = sub.notes as Record<string, string> | undefined;
  const planId = sub.plan_id as string | undefined;

  const subRecord = await resolveSubscriptionRow(db, razorpaySubscriptionId, notes);
  if (!subRecord) {
    // Not transient -- no local row and no usable notes. Acknowledge so
    // RazorPay stops retrying; log for investigation.
    console.warn(
      `subscription.activated/charged: no local record resolvable for ${razorpaySubscriptionId} — acknowledging without action`,
    );
    return;
  }

  const userId = subRecord.user_id;

  const planFromId = planId ? planByRazorpayPlanId(planId) : undefined;
  const plan = planFromId ?? PLANS[notes?.plan_tier ?? subRecord.plan_slug] ?? PLANS[subRecord.plan_slug];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;

  const currentStart = sub.current_start as number | undefined;
  const currentEnd = sub.current_end as number | undefined;

  const subUpdate: Record<string, unknown> = {
    status: "active",
    cancel_at_period_end: false,
    payment_gateway: "razorpay",
    razorpay_subscription_id: razorpaySubscriptionId,
  };
  if (plan?.slug) subUpdate.plan_slug = plan.slug;
  if (planId) subUpdate.razorpay_plan_id = planId;
  if (currentStart) subUpdate.current_period_start = new Date(currentStart * 1000).toISOString();
  if (currentEnd) subUpdate.current_period_end = new Date(currentEnd * 1000).toISOString();

  const { error: updateError } = await db
    .from("subscriptions")
    .update(subUpdate)
    .eq("id", subRecord.id);
  if (updateError) {
    console.error("Failed to update RazorPay subscription record:", updateError.message);
  }

  const { data: existingCredits } = await db
    .from("user_credits")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingCredits) {
    const { error: insertError } = await db.from("user_credits").insert({
      user_id: userId,
      monthly_credits_remaining: monthlyAllowance,
      purchased_balance: 0,
    });
    if (insertError) {
      if (insertError.code === "23505") {
        const { error: upsertError } = await db
          .from("user_credits")
          .update({ monthly_credits_remaining: monthlyAllowance })
          .eq("user_id", userId);
        if (upsertError) {
          throw new Error(`Failed to initialize credits: ${upsertError.message}`);
        }
      } else {
        throw new Error(`Failed to insert user_credits: ${insertError.message}`);
      }
    }

    await db.from("credit_transactions").insert({
      user_id: userId,
      type: "monthly_reset",
      amount: monthlyAllowance,
      bucket: "monthly",
      running_monthly_balance: monthlyAllowance,
      running_purchased_balance: 0,
      description: `Initial credit allocation for ${plan?.slug ?? "unknown"} plan (RazorPay)`,
    });

    console.log(`RazorPay: initialized ${monthlyAllowance} credits for user ${userId}`);
  } else {
    const { data: rpcResult, error: rpcError } = await db.rpc("reset_monthly_credits", {
      p_user_id: userId,
      p_allowance: monthlyAllowance,
    });
    if (rpcError) {
      throw new Error(`reset_monthly_credits RPC failed: ${rpcError.message}`);
    }
    console.log(`RazorPay: reset monthly credits for user ${userId}:`, rpcResult);
  }
}

/**
 * subscription.cancelled / .completed / .halted
 *
 * Mirrors webhook-stripe's handleSubscriptionDeleted: downgrade to free,
 * credits already granted are preserved (not clawed back).
 */
async function handleSubscriptionEnded(
  db: Db,
  sub: Record<string, unknown>,
): Promise<void> {
  const razorpaySubscriptionId = sub.id as string;
  const notes = sub.notes as Record<string, string> | undefined;

  const subRecord = await resolveSubscriptionRow(db, razorpaySubscriptionId, notes);
  if (!subRecord) {
    console.warn(
      `subscription ended: no local record for ${razorpaySubscriptionId} — acknowledging without action`,
    );
    return;
  }

  const { error: updateError } = await db
    .from("subscriptions")
    .update({ status: "expired", plan_slug: "free", cancel_at_period_end: false })
    .eq("id", subRecord.id);
  if (updateError) {
    throw new Error(`Failed to expire RazorPay subscription record: ${updateError.message}`);
  }

  console.log(
    `RazorPay: expired subscription for user ${subRecord.user_id}, downgraded to free (credits preserved)`,
  );
}

/**
 * order.paid / payment.captured — PAYG credit top-up.
 *
 * Only acts when the order carries `notes.credits` (set by checkout/index.ts
 * at Order-creation time, already converted from the requested USD amount
 * via the admin-configured INR rate) -- an order without it is not a PAYG
 * top-up created by this app and is ignored.
 */
async function handlePaygOrderPaid(
  db: Db,
  order: Record<string, unknown> | undefined,
  payment: Record<string, unknown> | undefined,
): Promise<void> {
  const notes = (order?.notes ?? payment?.notes) as Record<string, string> | undefined;
  const rawCredits = notes?.credits;
  const userId = notes?.user_id;
  const paymentId = (payment?.id as string | undefined) ?? (order?.id as string | undefined);

  if (!rawCredits || !userId) {
    console.log("order.paid/payment.captured: not a recognized PAYG top-up, skipping");
    return;
  }

  const credits = parseInt(rawCredits, 10);
  if (!Number.isFinite(credits) || credits <= 0 || credits > 1_000_000) {
    throw new Error(`invalid credits note on RazorPay order: "${rawCredits}"`);
  }

  const packId = notes?.pack_id;
  const description = packId
    ? `PAYG credit purchase: ${credits} credits (${packId}, RazorPay)`
    : `PAYG credit purchase: ${credits} credits (dynamic, RazorPay)`;

  const { error: rpcError } = await db.rpc("add_purchased_credits_razorpay", {
    p_user_id: userId,
    p_amount: credits,
    p_razorpay_payment_id: paymentId,
    p_description: description,
  });
  if (rpcError) {
    throw new Error(`add_purchased_credits_razorpay RPC failed for user ${userId}: ${rpcError.message}`);
  }

  console.log(`RazorPay: added ${credits} credits to user ${userId} (payment ${paymentId})`);
}

// ─── Event router ───────────────────────────────────────────────────────────

async function routeEvent(db: Db, payload: RazorpayWebhookPayload): Promise<boolean> {
  switch (payload.event) {
    case "subscription.activated":
    case "subscription.charged": {
      const sub = entity(payload, "subscription");
      if (!sub) return false;
      await handleSubscriptionActivatedOrCharged(db, sub);
      return true;
    }
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.halted": {
      const sub = entity(payload, "subscription");
      if (!sub) return false;
      await handleSubscriptionEnded(db, sub);
      return true;
    }
    case "order.paid":
    case "payment.captured": {
      const order = entity(payload, "order");
      const payment = entity(payload, "payment");
      await handlePaygOrderPaid(db, order, payment);
      return true;
    }
    case "subscription.pending":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.updated":
    case "subscription.authenticated":
      // Log-only for now -- matches AutoGPT platform's own scope for these
      // lifecycle events. The events above (activated/charged/ended) are
      // what actually move credits or plan state.
      console.log(`RazorPay lifecycle event (log-only): ${payload.event}`);
      return true;
    default:
      console.log(`Unhandled RazorPay event type: ${payload.event} -- returning 200`);
      return false;
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const secHeaders = getSecurityHeaders();
  const jsonHeaders = { "Content-Type": "application/json", ...secHeaders };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  if (!Deno.env.get("RAZORPAY_WEBHOOK_SECRET")) {
    console.error("RAZORPAY_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const signatureHeader = req.headers.get("X-Razorpay-Signature");
  const rawBody = await req.text();

  // Fails closed: verifyRazorpayWebhookSignature returns false (never
  // throws) when the secret or header is missing, so a misconfiguration
  // never falls through to "verification skipped."
  const verified = await verifyRazorpayWebhookSignature(rawBody, signatureHeader);
  if (!verified) {
    console.error("RazorPay webhook signature verification failed");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const db = supabaseAdmin();
  const eventKey = await hashBody(rawBody);

  if (await isEventAlreadyProcessed(db, eventKey)) {
    console.log(`RazorPay event ${eventKey.slice(0, 12)}… already processed, skipping`);
    return new Response(JSON.stringify({ received: true, status: "already_processed" }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  await recordEventStart(db, eventKey, payload.event, payload);

  try {
    const handled = await routeEvent(db, payload);
    await recordEventComplete(db, eventKey);

    return new Response(
      JSON.stringify({ received: true, status: handled ? "processed" : "ignored", type: payload.event }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Handler error";
    console.error(`Error processing RazorPay event ${payload.event}:`, message);
    await captureEdgeError(err, "webhook-razorpay", { event_type: payload.event });
    await deadLetter(db, payload, message);

    // Always 200 to RazorPay to prevent retry storms -- dead_letter_webhooks
    // handles retries on our side, same as webhook-stripe.
    return new Response(
      JSON.stringify({ received: true, status: "error_queued", type: payload.event }),
      { status: 200, headers: jsonHeaders },
    );
  }
});
