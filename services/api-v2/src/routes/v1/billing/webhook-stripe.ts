// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/webhooks/stripe — receives and processes ALL Stripe
 * webhook events for the vantly-ugc billing system.
 *
 * Ported from supabase/functions/webhook-stripe (a Supabase Edge Function)
 * — see checkout.ts's file comment for why this self-hosted deployment
 * needs api-v2 routes instead of Edge Functions. This route is called
 * directly by Stripe's servers (not proxied through apps/web at all, and
 * NOT behind authMiddleware — Stripe has no user JWT to send; the
 * Stripe-Signature header is the auth), so update the webhook endpoint URL
 * configured in the Stripe Dashboard to point here
 * (https://<api-v2-host>/v1/billing/webhooks/stripe) once this deploys.
 *
 * Requires `req.rawBody` (a Buffer of the exact bytes Stripe signed) to be
 * populated -- see server.ts's express.json({ verify }) callback, added
 * specifically for this and webhook-razorpay.ts.
 *
 * Every event is verified via HMAC-SHA256 signature (stripe.ts's
 * verifyStripeSignature), de-duplicated through the stripe_webhook_events
 * table, and dispatched to the appropriate handler. Handled event types:
 *   - invoice.paid                          (monthly reset / first subscription)
 *   - customer.subscription.updated         (plan changes, trial end)
 *   - customer.subscription.deleted         (cancellation)
 *   - payment_intent.succeeded              (PAYG credit purchases)
 *   - checkout.session.completed / .async_payment_succeeded (post-checkout linkage)
 *
 * STRIPE_WEBHOOK_SECRET stays env-only (no payment_gateway_settings column
 * for it -- that table only stores API credentials, not webhook signing
 * secrets, since a webhook endpoint's secret is tied to the endpoint URL
 * registered in the Stripe Dashboard, not to which gateway is "active").
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';
import { verifyStripeSignature, StripeEvent } from '../../../lib/billing/stripe.js';
import { PLANS, PAYG_PACKS, resolvePlanByStripePriceId, type PlanDefinition } from '../../../lib/billing/plans.js';
import { notifyTelegram } from '../../../lib/billing/telegram.js';
import * as Sentry from '@sentry/node';

// ─── Idempotency ────────────────────────────────────────────────────────────

async function isEventAlreadyProcessed(stripeEventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('stripe_webhook_events')
    .select('stripe_event_id, processed_at')
    .eq('stripe_event_id', stripeEventId)
    .maybeSingle();

  if (error) {
    console.error('Error checking event idempotency:', error.message);
    return false;
  }
  return !!data?.processed_at;
}

async function recordEventStart(event: StripeEvent): Promise<void> {
  const { error } = await supabase.from('stripe_webhook_events').upsert(
    { stripe_event_id: event.id, event_type: event.type, processed_at: null, payload: event as unknown as Record<string, unknown> },
    { onConflict: 'stripe_event_id' },
  );
  if (error) console.error('Failed to record event start:', error.message);
}

async function recordEventComplete(stripeEventId: string): Promise<void> {
  const { error } = await supabase
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('stripe_event_id', stripeEventId);
  if (error) console.error('Failed to mark event complete:', error.message);
}

async function deadLetter(event: StripeEvent, errorMessage: string): Promise<void> {
  const { error } = await supabase.from('dead_letter_webhooks').insert({
    provider_slug: 'stripe',
    payload: event as unknown as Record<string, unknown>,
    error_message: errorMessage,
    status: 'pending',
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) console.error('Failed to insert dead letter:', error.message);
}

// ─── Event handlers ─────────────────────────────────────────────────────────

async function handleInvoicePaid(invoice: Record<string, unknown>): Promise<void> {
  const stripeSubscriptionId = invoice.subscription as string | null;
  if (!stripeSubscriptionId) {
    console.log('invoice.paid: no subscription ID, skipping');
    return;
  }

  const billingReason = invoice.billing_reason as string | undefined;
  const lines = invoice.lines as { data?: Array<Record<string, unknown>> } | undefined;
  const lineItem = lines?.data?.[0];
  const price = lineItem?.price as Record<string, unknown> | undefined;
  const priceId = price?.id as string | undefined;

  let plan: PlanDefinition | undefined;
  if (priceId) plan = await resolvePlanByStripePriceId(supabase, priceId);

  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (subError) throw new Error(`Failed to look up subscription: ${subError.message}`);
  if (!subscription) throw new Error(`Subscription ${stripeSubscriptionId} not found in database`);

  const userId = subscription.user_id as string;
  if (!plan) plan = PLANS[subscription.plan_slug as string];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;

  const periodStart = lineItem?.period as Record<string, unknown> | undefined;
  const currentPeriodStart = periodStart?.start ? new Date((periodStart.start as number) * 1000).toISOString() : null;
  const currentPeriodEnd = periodStart?.end ? new Date((periodStart.end as number) * 1000).toISOString() : null;

  const subUpdate: Record<string, unknown> = { status: 'active', cancel_at_period_end: false };
  const currentPlan = PLANS[subscription.plan_slug as string];
  if (plan?.slug && plan.monthlyCredits >= (currentPlan?.monthlyCredits ?? 0)) {
    subUpdate.plan_slug = plan.slug;
  }
  if (currentPeriodStart) subUpdate.current_period_start = currentPeriodStart;
  if (currentPeriodEnd) subUpdate.current_period_end = currentPeriodEnd;
  if (priceId && (!plan || plan.monthlyCredits >= (currentPlan?.monthlyCredits ?? 0))) {
    subUpdate.stripe_price_id = priceId;
    if (price?.product) subUpdate.stripe_product_id = price.product as string;
  }

  const { error: updateSubError } = await supabase.from('subscriptions').update(subUpdate).eq('id', subscription.id);
  if (updateSubError) console.error('Failed to update subscription:', updateSubError.message);

  if (billingReason === 'subscription_create' || billingReason === 'subscription_cycle') {
    const { data: existingCredits } = await supabase.from('user_credits').select('id').eq('user_id', userId).maybeSingle();

    if (!existingCredits && billingReason === 'subscription_create') {
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
        description: `Initial credit allocation for ${plan?.slug ?? 'unknown'} plan`,
      });

      console.log(`invoice.paid: initialized ${monthlyAllowance} credits for user ${userId}`);
    } else {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('reset_monthly_credits', {
        p_user_id: userId,
        p_allowance: monthlyAllowance,
      });
      if (rpcError) throw new Error(`reset_monthly_credits RPC failed: ${rpcError.message}`);
      console.log(`invoice.paid: reset monthly credits for user ${userId}:`, rpcResult);
    }
  } else {
    console.log(`invoice.paid: billing_reason="${billingReason}", no credit action`);
  }
}

async function handleSubscriptionUpdated(
  subscription: Record<string, unknown>,
  previousAttributes: Record<string, unknown> | undefined,
): Promise<void> {
  const stripeSubscriptionId = subscription.id as string;

  const { data: subRecord, error: subError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (subError) throw new Error(`subscription.updated: lookup failed for ${stripeSubscriptionId}: ${subError.message}`);
  if (!subRecord) {
    console.warn(`subscription.updated: no local record for ${stripeSubscriptionId} — acknowledging without action`);
    return;
  }

  const userId = subRecord.user_id as string;

  const items = subscription.items as { data?: Array<Record<string, unknown>> } | undefined;
  const currentItem = items?.data?.[0];
  const currentPrice = currentItem?.price as Record<string, unknown> | undefined;
  const currentPriceId = currentPrice?.id as string | undefined;

  const stripeStatus = subscription.status as string;
  const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;

  const updatePayload: Record<string, unknown> = { status: stripeStatus, cancel_at_period_end: cancelAtPeriodEnd };

  if (subscription.current_period_start) {
    updatePayload.current_period_start = new Date((subscription.current_period_start as number) * 1000).toISOString();
  }
  if (subscription.current_period_end) {
    updatePayload.current_period_end = new Date((subscription.current_period_end as number) * 1000).toISOString();
  }
  if (subscription.trial_end) {
    updatePayload.trial_ends_at = new Date((subscription.trial_end as number) * 1000).toISOString();
  }

  const previousItems = previousAttributes?.items as { data?: Array<Record<string, unknown>> } | undefined;
  const previousPrice = previousItems?.data?.[0]?.price as Record<string, unknown> | undefined;
  const previousPriceId = previousPrice?.id as string | undefined;

  const planChanged = !!(currentPriceId && previousPriceId && currentPriceId !== previousPriceId);
  const currentPlan = currentPriceId ? await resolvePlanByStripePriceId(supabase, currentPriceId) : undefined;

  if (currentPlan && currentPriceId) {
    const existingPlan = PLANS[subRecord.plan_slug as string];
    const shouldApplyPlan = currentPlan.monthlyCredits >= (existingPlan?.monthlyCredits ?? 0);

    if (shouldApplyPlan) {
      updatePayload.plan_slug = currentPlan.slug;
      updatePayload.stripe_price_id = currentPriceId;
      if (currentPrice?.product) updatePayload.stripe_product_id = currentPrice.product as string;
    } else {
      console.log(`subscription.updated: ignoring lower-tier retry for user ${userId}: ${subRecord.plan_slug} -> ${currentPlan.slug}`);
    }

    if (shouldApplyPlan && (planChanged || currentPlan.slug !== subRecord.plan_slug)) {
      console.log(`subscription.updated: plan change for user ${userId}: ${subRecord.plan_slug} -> ${currentPlan.slug}`);
      notifyTelegram(`<b>Plan change</b>\nUser: ${userId}\n${subRecord.plan_slug} → ${currentPlan.slug}`);
    }
  } else if (currentPriceId) {
    updatePayload.stripe_price_id = currentPriceId;
    if (currentPrice?.product) updatePayload.stripe_product_id = currentPrice.product as string;
  }

  const previousStatus = previousAttributes?.status as string | undefined;
  const currentStatus = subscription.status as string;
  if (previousStatus === 'trialing' && currentStatus === 'active') {
    console.log(`subscription.updated: trial ended for user ${userId}, now active`);
  }

  const { error: updateError } = await supabase.from('subscriptions').update(updatePayload).eq('id', subRecord.id);
  if (updateError) throw new Error(`Failed to update subscription record: ${updateError.message}`);

  console.log(`subscription.updated: updated subscription for user ${userId}, status=${currentStatus}`);
}

async function handleSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
  const stripeSubscriptionId = subscription.id as string;

  const { data: subRecord, error: subError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (subError) throw new Error(`subscription.deleted: lookup failed for ${stripeSubscriptionId}: ${subError.message}`);
  if (!subRecord) {
    console.warn(`subscription.deleted: no local record for ${stripeSubscriptionId} — acknowledging without action`);
    return;
  }

  const userId = subRecord.user_id as string;

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'expired', plan_slug: 'free', cancel_at_period_end: false })
    .eq('id', subRecord.id);
  if (updateError) throw new Error(`Failed to expire subscription record: ${updateError.message}`);

  console.log(`subscription.deleted: expired subscription for user ${userId}, plan downgraded from ${subRecord.plan_slug} to free (credits preserved)`);
}

function resolvePaygCredits(
  metadata: Record<string, string> | undefined,
): { amount: number; source: 'dynamic' | 'pack'; description: string } | null {
  const packId = metadata?.pack_id ?? metadata?.payg_pack_id;
  const rawCredits = metadata?.credits;

  if (rawCredits) {
    const parsed = parseInt(rawCredits, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
      throw new Error(`invalid credits metadata "${rawCredits}"`);
    }
    return { amount: parsed, source: 'dynamic', description: `PAYG credit purchase: ${parsed} credits (dynamic, $${(parsed / 100).toFixed(2)})` };
  }

  if (packId) {
    const pack = PAYG_PACKS[packId];
    if (!pack) throw new Error(`Unknown pack_id in metadata: ${packId}`);
    return { amount: pack.credits, source: 'pack', description: `PAYG credit purchase: ${pack.credits} credits (${packId})` };
  }

  return null;
}

async function handlePaymentIntentSucceeded(paymentIntent: Record<string, unknown>): Promise<void> {
  const metadata = paymentIntent.metadata as Record<string, string> | undefined;

  const resolved = resolvePaygCredits(metadata);
  if (!resolved) {
    console.log('payment_intent.succeeded: no credits or pack_id in metadata, skipping');
    return;
  }
  const credits = resolved.amount;

  const stripeCustomerId = paymentIntent.customer as string | null;
  const paymentIntentId = paymentIntent.id as string;

  let userId = metadata?.user_id ?? null;

  if (!userId) {
    if (!stripeCustomerId) throw new Error('payment_intent.succeeded: no user_id metadata and no customer ID');

    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();

    if (subError || !subscription) {
      throw new Error(`No subscription found for customer ${stripeCustomerId}: ${subError?.message ?? 'not found'}`);
    }
    userId = subscription.user_id as string;
  }

  const { error: rpcError } = await supabase.rpc('add_purchased_credits', {
    p_user_id: userId,
    p_amount: credits,
    p_payment_intent_id: paymentIntentId,
    p_description: resolved.description,
  });
  if (rpcError) throw new Error(`add_purchased_credits RPC failed for user ${userId}: ${rpcError.message}`);

  console.log(`payment_intent.succeeded: added ${credits} credits to user ${userId} (${resolved.source}, PI: ${paymentIntentId})`);
}

async function handleCheckoutSessionCompleted(session: Record<string, unknown>): Promise<void> {
  const stripeCustomerId = session.customer as string | null;
  const stripeSubscriptionId = session.subscription as string | null;
  const mode = session.mode as string;

  const metadata = session.metadata as Record<string, string> | undefined;
  const userId = (session.client_reference_id as string | null) ?? metadata?.user_id ?? null;

  if (!stripeCustomerId) {
    console.log('checkout.session.completed: no customer ID, skipping');
    return;
  }

  if (mode === 'subscription' && stripeSubscriptionId && userId) {
    const planTier = metadata?.plan_tier ?? 'starter';
    const plan = PLANS[planTier];
    const monthlyCredits = plan?.monthlyCredits ?? 0;

    const { data: existing } = await supabase.from('subscriptions').select('id, plan_slug').eq('user_id', userId).maybeSingle();

    if (existing) {
      const existingPlan = PLANS[existing.plan_slug as string];
      const shouldApplyPlan = monthlyCredits >= (existingPlan?.monthlyCredits ?? 0);
      const updatePayload: Record<string, unknown> = {
        status: 'active',
        cancel_at_period_end: false,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
      };
      if (shouldApplyPlan) updatePayload.plan_slug = planTier;

      const { error: updateError } = await supabase.from('subscriptions').update(updatePayload).eq('id', existing.id);
      if (updateError) throw new Error(`Failed to link Stripe IDs to subscription: ${updateError.message}`);

      console.log(`checkout.session.completed: linked Stripe customer ${stripeCustomerId} to user ${userId}`);

      if (monthlyCredits > 0) {
        const { data: existingCredits } = await supabase
          .from('user_credits')
          .select('id, monthly_credits_remaining')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingCredits) {
          if ((existingCredits.monthly_credits_remaining as number) < monthlyCredits) {
            await supabase.from('user_credits').update({ monthly_credits_remaining: monthlyCredits }).eq('user_id', userId);
          }
        } else {
          await supabase.from('user_credits').insert({ user_id: userId, monthly_credits_remaining: monthlyCredits, purchased_balance: 0 });
        }
      }
    } else {
      const { error: insertError } = await supabase.from('subscriptions').insert({
        user_id: userId,
        plan_slug: planTier,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
        cancel_at_period_end: false,
      });
      if (insertError) throw new Error(`Failed to create subscription record: ${insertError.message}`);

      console.log(`checkout.session.completed: created subscription for user ${userId} (plan=${planTier})`);
      notifyTelegram(`<b>New subscription</b>\nUser: ${userId}\nPlan: ${planTier}`);

      if (monthlyCredits > 0) {
        const { data: existingCredits } = await supabase
          .from('user_credits')
          .select('id, monthly_credits_remaining')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingCredits) {
          if ((existingCredits.monthly_credits_remaining as number) === 0) {
            await supabase.from('user_credits').update({ monthly_credits_remaining: monthlyCredits }).eq('user_id', userId);
            console.log(`checkout.session.completed: allocated ${monthlyCredits} monthly credits for ${userId}`);
          }
        } else {
          await supabase.from('user_credits').insert({ user_id: userId, monthly_credits_remaining: monthlyCredits, purchased_balance: 0 });
          console.log(`checkout.session.completed: created user_credits with ${monthlyCredits} monthly for ${userId}`);
        }
      }
    }
  } else if (mode === 'payment' && userId) {
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('user_id', userId)
      .is('stripe_customer_id', null);
    if (updateError) console.error('checkout.session.completed: failed to link customer:', updateError.message);

    const paymentStatus = session.payment_status as string | undefined;
    if (paymentStatus !== 'paid') {
      console.log(`checkout.session.completed: PAYG session for user ${userId} is payment_status=${paymentStatus}, not crediting yet`);
      return;
    }

    const paymentIntentId = session.payment_intent as string | null;
    if (!paymentIntentId) {
      throw new Error(`checkout.session.completed: paid PAYG session for user ${userId} has no payment_intent`);
    }

    const credits = resolvePaygCredits(metadata);
    if (credits === null) {
      console.log(`checkout.session.completed: PAYG session for user ${userId} has no credits/pack_id metadata, skipping`);
      return;
    }

    const { error: rpcError } = await supabase.rpc('add_purchased_credits', {
      p_user_id: userId,
      p_amount: credits.amount,
      p_payment_intent_id: paymentIntentId,
      p_description: credits.description,
    });
    if (rpcError) throw new Error(`add_purchased_credits RPC failed for user ${userId} (PI: ${paymentIntentId}): ${rpcError.message}`);

    console.log(`checkout.session.completed: credited ${credits.amount} credits to user ${userId} (${credits.source}, PI: ${paymentIntentId})`);
  } else {
    console.log(`checkout.session.completed: mode=${mode}, no action required`);
  }
}

// ─── Event router ───────────────────────────────────────────────────────────

async function routeEvent(event: StripeEvent): Promise<boolean> {
  const obj = event.data.object;

  switch (event.type) {
    case 'invoice.paid':
      await handleInvoicePaid(obj);
      return true;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(obj, event.data.previous_attributes);
      return true;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(obj);
      return true;
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(obj);
      return true;
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await handleCheckoutSessionCompleted(obj);
      return true;
    default:
      console.log(`Unhandled event type: ${event.type} -- returning 200`);
      return false;
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function webhookStripeRoute(req: Request, res: Response): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const signatureHeader = req.headers['stripe-signature'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    res.status(400).json({ error: 'Missing Stripe-Signature header' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.error('webhook-stripe: rawBody not captured -- check express.json({ verify }) in server.ts');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  let event: StripeEvent;
  try {
    event = await verifyStripeSignature(rawBody.toString('utf8'), signatureHeader, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    console.error('Stripe signature verification failed:', message);
    res.status(400).json({ error: message });
    return;
  }

  if (await isEventAlreadyProcessed(event.id)) {
    console.log(`Event ${event.id} already processed, skipping`);
    res.status(200).json({ received: true, status: 'already_processed' });
    return;
  }

  await recordEventStart(event);

  try {
    const handled = await routeEvent(event);
    await recordEventComplete(event.id);
    res.status(200).json({ received: true, status: handled ? 'processed' : 'ignored', type: event.type });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler error';
    console.error(`Error processing ${event.type} (${event.id}):`, message);
    Sentry.captureException(err, { tags: { webhook: 'stripe', event_type: event.type, event_id: event.id } });
    await deadLetter(event, message);
    // ALWAYS return 200 to Stripe to prevent retry storms -- dead_letter_webhooks handles retries on our side.
    res.status(200).json({ received: true, status: 'error_queued', type: event.type });
  }
}
