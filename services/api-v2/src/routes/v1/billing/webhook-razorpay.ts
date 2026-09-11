// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/webhooks/razorpay — receives and processes RazorPay
 * webhook events for subscription billing and PAYG credit top-ups.
 *
 * Ported from supabase/functions/webhook-razorpay (a Supabase Edge
 * Function) — see checkout.ts's file comment for why this self-hosted
 * deployment needs api-v2 routes instead of Edge Functions. Parallel to
 * webhook-stripe.ts (same verify -> dedup -> route -> dead-letter shape).
 * Called directly by RazorPay's servers (not proxied through apps/web, and
 * NOT behind authMiddleware — the X-Razorpay-Signature header is the
 * auth), so update the webhook endpoint URL configured in the RazorPay
 * Dashboard to point here (https://<api-v2-host>/v1/billing/webhooks/razorpay)
 * once this deploys.
 *
 * Requires `req.rawBody` (a Buffer of the exact bytes RazorPay signed) —
 * see server.ts's express.json({ verify }) callback.
 *
 * Idempotency: RazorPay does not include a stable webhook-delivery id in
 * its payload (unlike Stripe's `event.id`), so the dedup key here is a
 * SHA-256 hash of the raw request body -- a genuine retry resends a
 * byte-identical body, so this is equivalent in practice to an event id.
 *
 * RAZORPAY_WEBHOOK_SECRET stays env-only (same reasoning as
 * STRIPE_WEBHOOK_SECRET in webhook-stripe.ts).
 */

import type { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { supabase } from '../../../server.js';
import { verifyRazorpayWebhookSignature } from '../../../lib/billing/razorpay.js';
import { PLANS, resolvePlanByRazorpayPlanId } from '../../../lib/billing/plans.js';
import * as Sentry from '@sentry/node';

interface RazorpayWebhookPayload {
  event: string;
  payload: Record<string, { entity?: Record<string, unknown> } | undefined>;
}

function entity(payload: RazorpayWebhookPayload, key: string): Record<string, unknown> | undefined {
  return payload.payload?.[key]?.entity;
}

// ─── Idempotency ────────────────────────────────────────────────────────────

function hashBody(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

async function isEventAlreadyProcessed(eventKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('razorpay_webhook_events')
    .select('razorpay_event_id, processed_at')
    .eq('razorpay_event_id', eventKey)
    .maybeSingle();

  if (error) {
    console.error('Error checking RazorPay event idempotency:', error.message);
    return false;
  }
  return !!data?.processed_at;
}

async function recordEventStart(eventKey: string, eventType: string, payload: unknown): Promise<void> {
  const { error } = await supabase
    .from('razorpay_webhook_events')
    .upsert({ razorpay_event_id: eventKey, event_type: eventType, processed_at: null, payload }, { onConflict: 'razorpay_event_id' });
  if (error) console.error('Failed to record RazorPay event start:', error.message);
}

async function recordEventComplete(eventKey: string): Promise<void> {
  const { error } = await supabase
    .from('razorpay_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('razorpay_event_id', eventKey);
  if (error) console.error('Failed to mark RazorPay event complete:', error.message);
}

async function deadLetter(payload: unknown, errorMessage: string): Promise<void> {
  const { error } = await supabase.from('dead_letter_webhooks').insert({
    provider_slug: 'razorpay',
    payload: payload as Record<string, unknown>,
    error_message: errorMessage,
    status: 'pending',
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) console.error('Failed to insert RazorPay dead letter:', error.message);
}

// ─── Subscription row resolution ───────────────────────────────────────────

interface SubRow {
  id: string;
  user_id: string;
  plan_slug: string;
}

async function resolveSubscriptionRow(
  razorpaySubscriptionId: string,
  notes: Record<string, string> | undefined,
): Promise<SubRow | null> {
  const { data: byId, error: byIdError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('razorpay_subscription_id', razorpaySubscriptionId)
    .maybeSingle();

  if (byIdError) throw new Error(`subscription lookup failed: ${byIdError.message}`);
  if (byId) return byId as SubRow;

  const userId = notes?.user_id;
  if (!userId) return null;

  const { data: byUser, error: byUserError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUserError) throw new Error(`subscription lookup by user failed: ${byUserError.message}`);
  if (!byUser) return null;

  await supabase
    .from('subscriptions')
    .update({ razorpay_subscription_id: razorpaySubscriptionId, payment_gateway: 'razorpay' })
    .eq('id', byUser.id);

  return byUser as SubRow;
}

// ─── Event handlers ─────────────────────────────────────────────────────────

/**
 * Shared by handleSubscriptionActivatedOrCharged (real charge lands) and
 * handleSubscriptionAuthenticated (trial_months coupon activates before
 * any real charge) -- both need identical "grant on first credit row,
 * else reset_monthly_credits" behavior. reset_monthly_credits is a flat
 * "set monthly_credits_remaining to the new allowance" operation, not
 * period-boundary-aware, so calling this once at trial start and again
 * independently when the real charge lands is correct (same as it already
 * is for every ordinary monthly renewal) -- not a double-grant.
 */
async function grantOrResetMonthlyCredits(
  userId: string,
  monthlyAllowance: number,
  planSlugForLog: string,
  contextLabel: string,
): Promise<void> {
  const { data: existingCredits } = await supabase.from('user_credits').select('id').eq('user_id', userId).maybeSingle();

  if (!existingCredits) {
    const { error: insertError } = await supabase
      .from('user_credits')
      .insert({ user_id: userId, monthly_credits_remaining: monthlyAllowance, purchased_balance: 0 });

    if (insertError) {
      if (insertError.code === '23505') {
        const { error: upsertError } = await supabase
          .from('user_credits')
          .update({ monthly_credits_remaining: monthlyAllowance })
          .eq('user_id', userId);
        if (upsertError) throw new Error(`Failed to initialize credits: ${upsertError.message}`);
      } else {
        throw new Error(`Failed to insert user_credits: ${insertError.message}`);
      }
    }

    await supabase.from('credit_transactions').insert({
      user_id: userId,
      type: 'monthly_reset',
      amount: monthlyAllowance,
      bucket: 'monthly',
      running_monthly_balance: monthlyAllowance,
      running_purchased_balance: 0,
      description: `Initial credit allocation for ${planSlugForLog} plan (RazorPay)`,
    });

    console.log(`RazorPay: initialized ${monthlyAllowance} credits for user ${userId} (${contextLabel})`);
  } else {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('reset_monthly_credits', {
      p_user_id: userId,
      p_allowance: monthlyAllowance,
    });
    if (rpcError) throw new Error(`reset_monthly_credits RPC failed: ${rpcError.message}`);
    console.log(`RazorPay: reset monthly credits for user ${userId} (${contextLabel}):`, rpcResult);
  }
}

async function handleSubscriptionActivatedOrCharged(sub: Record<string, unknown>): Promise<void> {
  const razorpaySubscriptionId = sub.id as string;
  const notes = sub.notes as Record<string, string> | undefined;
  const planId = sub.plan_id as string | undefined;

  const subRecord = await resolveSubscriptionRow(razorpaySubscriptionId, notes);
  if (!subRecord) {
    console.warn(`subscription.activated/charged: no local record resolvable for ${razorpaySubscriptionId} — acknowledging without action`);
    return;
  }

  const userId = subRecord.user_id;

  const planFromId = planId ? await resolvePlanByRazorpayPlanId(supabase, planId) : undefined;
  const plan = planFromId ?? PLANS[notes?.plan_tier ?? subRecord.plan_slug] ?? PLANS[subRecord.plan_slug];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;

  const currentStart = sub.current_start as number | undefined;
  const currentEnd = sub.current_end as number | undefined;

  const subUpdate: Record<string, unknown> = {
    status: 'active',
    cancel_at_period_end: false,
    payment_gateway: 'razorpay',
    razorpay_subscription_id: razorpaySubscriptionId,
  };
  if (plan?.slug) subUpdate.plan_slug = plan.slug;
  if (planId) subUpdate.razorpay_plan_id = planId;
  if (currentStart) subUpdate.current_period_start = new Date(currentStart * 1000).toISOString();
  if (currentEnd) subUpdate.current_period_end = new Date(currentEnd * 1000).toISOString();

  const { error: updateError } = await supabase.from('subscriptions').update(subUpdate).eq('id', subRecord.id);
  if (updateError) console.error('Failed to update RazorPay subscription record:', updateError.message);

  await grantOrResetMonthlyCredits(userId, monthlyAllowance, plan?.slug ?? 'unknown', 'activated/charged');
}

/**
 * subscription.authenticated: the customer has completed RazorPay's
 * mandate-setup step. For an ordinary (non-trial) subscription this is
 * purely informational -- real activation is subscription.activated/
 * charged, handled above. For a trial_months-coupon subscription (created
 * with a future start_at, see checkout.ts), this IS the moment of genuine
 * commitment: the mandate is confirmed even though the real charge won't
 * happen until start_at. So this is where the trial actually activates --
 * status/trial_ends_at/credits/coupon redemption -- mirroring what
 * checkout.session.completed does for a Stripe trial.
 */
async function handleSubscriptionAuthenticated(sub: Record<string, unknown>): Promise<void> {
  const razorpaySubscriptionId = sub.id as string;
  const notes = sub.notes as Record<string, string> | undefined;
  const couponCode = notes?.coupon_code;

  if (!couponCode) {
    console.log(`RazorPay lifecycle event (log-only, no trial coupon): subscription.authenticated for ${razorpaySubscriptionId}`);
    return;
  }

  const subRecord = await resolveSubscriptionRow(razorpaySubscriptionId, notes);
  if (!subRecord) {
    console.warn(`subscription.authenticated: no local record resolvable for ${razorpaySubscriptionId} — acknowledging without action`);
    return;
  }

  // Only activate once: a retried webhook delivery, or a subscription that
  // already progressed past its initial pending state, must not re-grant
  // credits or attempt a second coupon redemption.
  const { data: currentRow, error: currentRowError } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('id', subRecord.id)
    .maybeSingle();
  if (currentRowError) throw new Error(`subscription.authenticated: failed to read current status: ${currentRowError.message}`);
  if (currentRow && currentRow.status !== 'unpaid') {
    console.log(`subscription.authenticated: subscription ${razorpaySubscriptionId} already past pending (status=${currentRow.status}), skipping trial activation`);
    return;
  }

  const userId = subRecord.user_id;
  const planId = sub.plan_id as string | undefined;
  const planFromId = planId ? await resolvePlanByRazorpayPlanId(supabase, planId) : undefined;
  const plan = planFromId ?? PLANS[notes?.plan_tier ?? subRecord.plan_slug] ?? PLANS[subRecord.plan_slug];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;
  const planSlug = plan?.slug ?? subRecord.plan_slug;

  const startAt = sub.start_at as number | undefined;
  const subUpdate: Record<string, unknown> = {
    status: 'trialing',
    payment_gateway: 'razorpay',
    razorpay_subscription_id: razorpaySubscriptionId,
    trial_ends_at: startAt ? new Date(startAt * 1000).toISOString() : null,
  };
  if (plan?.slug) subUpdate.plan_slug = plan.slug;
  if (planId) subUpdate.razorpay_plan_id = planId;

  const { error: updateError } = await supabase.from('subscriptions').update(subUpdate).eq('id', subRecord.id);
  if (updateError) throw new Error(`Failed to activate RazorPay trial subscription: ${updateError.message}`);

  await grantOrResetMonthlyCredits(userId, monthlyAllowance, planSlug ?? 'unknown', 'trial start');

  const { error: redeemError } = await supabase.rpc('redeem_coupon', {
    p_code: couponCode,
    p_user_id: userId,
    p_plan_slug: planSlug,
  });
  if (redeemError) {
    console.error(`subscription.authenticated: failed to redeem trial coupon ${couponCode} for user ${userId}:`, redeemError.message);
    Sentry.captureException(redeemError, { extra: { userId, couponCode, context: 'razorpay_trial_coupon_redeem' } });
  } else {
    console.log(`subscription.authenticated: redeemed trial coupon ${couponCode} for user ${userId}`);
  }

  console.log(`RazorPay: activated trial for user ${userId}, plan=${planSlug}, trial_ends_at=${subUpdate.trial_ends_at}`);
}

async function handleSubscriptionEnded(sub: Record<string, unknown>): Promise<void> {
  const razorpaySubscriptionId = sub.id as string;
  const notes = sub.notes as Record<string, string> | undefined;

  const subRecord = await resolveSubscriptionRow(razorpaySubscriptionId, notes);
  if (!subRecord) {
    console.warn(`subscription ended: no local record for ${razorpaySubscriptionId} — acknowledging without action`);
    return;
  }

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'expired', plan_slug: 'free', cancel_at_period_end: false })
    .eq('id', subRecord.id);
  if (updateError) throw new Error(`Failed to expire RazorPay subscription record: ${updateError.message}`);

  console.log(`RazorPay: expired subscription for user ${subRecord.user_id}, downgraded to free (credits preserved)`);
}

async function handlePaygOrderPaid(
  order: Record<string, unknown> | undefined,
  payment: Record<string, unknown> | undefined,
): Promise<void> {
  const notes = (order?.notes ?? payment?.notes) as Record<string, string> | undefined;
  const rawCredits = notes?.credits;
  const userId = notes?.user_id;
  const paymentId = (payment?.id as string | undefined) ?? (order?.id as string | undefined);

  if (!rawCredits || !userId) {
    console.log('order.paid/payment.captured: not a recognized PAYG top-up, skipping');
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

  const { error: rpcError } = await supabase.rpc('add_purchased_credits_razorpay', {
    p_user_id: userId,
    p_amount: credits,
    p_razorpay_payment_id: paymentId,
    p_description: description,
  });
  if (rpcError) throw new Error(`add_purchased_credits_razorpay RPC failed for user ${userId}: ${rpcError.message}`);

  console.log(`RazorPay: added ${credits} credits to user ${userId} (payment ${paymentId})`);
}

// ─── Event router ───────────────────────────────────────────────────────────

async function routeEvent(payload: RazorpayWebhookPayload): Promise<boolean> {
  switch (payload.event) {
    case 'subscription.activated':
    case 'subscription.charged': {
      const sub = entity(payload, 'subscription');
      if (!sub) return false;
      await handleSubscriptionActivatedOrCharged(sub);
      return true;
    }
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.halted': {
      const sub = entity(payload, 'subscription');
      if (!sub) return false;
      await handleSubscriptionEnded(sub);
      return true;
    }
    case 'order.paid':
    case 'payment.captured': {
      const order = entity(payload, 'order');
      const payment = entity(payload, 'payment');
      await handlePaygOrderPaid(order, payment);
      return true;
    }
    case 'subscription.authenticated': {
      const sub = entity(payload, 'subscription');
      if (!sub) return false;
      await handleSubscriptionAuthenticated(sub);
      return true;
    }
    case 'subscription.pending':
    case 'subscription.paused':
    case 'subscription.resumed':
    case 'subscription.updated':
      console.log(`RazorPay lifecycle event (log-only): ${payload.event}`);
      return true;
    default:
      console.log(`Unhandled RazorPay event type: ${payload.event} -- returning 200`);
      return false;
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function webhookRazorpayRoute(req: Request, res: Response): Promise<void> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const signatureHeader = req.headers['x-razorpay-signature'];
  const rawBodyBuf = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBodyBuf) {
    console.error('webhook-razorpay: rawBody not captured -- check express.json({ verify }) in server.ts');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }
  const rawBody = rawBodyBuf.toString('utf8');

  const verified = await verifyRazorpayWebhookSignature(
    rawBody,
    typeof signatureHeader === 'string' ? signatureHeader : null,
    secret,
  );
  if (!verified) {
    console.error('RazorPay webhook signature verification failed');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const eventKey = hashBody(rawBody);

  if (await isEventAlreadyProcessed(eventKey)) {
    console.log(`RazorPay event ${eventKey.slice(0, 12)}… already processed, skipping`);
    res.status(200).json({ received: true, status: 'already_processed' });
    return;
  }

  await recordEventStart(eventKey, payload.event, payload);

  try {
    const handled = await routeEvent(payload);
    await recordEventComplete(eventKey);
    res.status(200).json({ received: true, status: handled ? 'processed' : 'ignored', type: payload.event });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler error';
    console.error(`Error processing RazorPay event ${payload.event}:`, message);
    Sentry.captureException(err, { tags: { webhook: 'razorpay', event_type: payload.event } });
    await deadLetter(payload, message);
    // Always 200 to RazorPay to prevent retry storms -- dead_letter_webhooks handles retries on our side.
    res.status(200).json({ received: true, status: 'error_queued', type: payload.event });
  }
}
