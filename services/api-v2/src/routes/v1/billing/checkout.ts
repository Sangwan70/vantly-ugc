// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/checkout — create a Stripe Checkout Session or a
 * RazorPay subscription/order, for subscription upgrades and PAYG
 * (pay-as-you-go) credit pack purchases.
 *
 * Ported from supabase/functions/checkout (a Supabase Edge Function). This
 * self-hosted stack's gateway (supabase/self-host-gateway/nginx.conf)
 * deliberately only proxies /auth/v1, /rest/v1, /storage/v1 — there is no
 * Edge Functions runtime behind it at all, so every
 * supabase.functions.invoke('checkout') call 404'd here with "This gateway
 * only serves ..." (reported as PayPal-specific "not_found" errors, but the
 * same 404 hit every gateway — Stripe and RazorPay too — since the whole
 * Edge Functions runtime is unreachable, not just a PayPal-specific gap).
 * api-v2 already has its own auth middleware and a service-role DB client
 * (see credits-check.ts, the precedent this follows), so this reimplements
 * the same logic as a plain route. supabase/functions/checkout is
 * unchanged and still used by the hosted (non-self-hosted) deployment —
 * keep the two in sync if the checkout logic ever changes; they read the
 * same tables and RPCs.
 *
 * Behavioral differences from the original, all intentional:
 *
 * 1. Gateway/credential resolution is DB-first (payment_gateway_settings,
 *    via lib/billing/gateway-settings.ts), env-fallback — the original was
 *    100% env-var-driven (PAYMENT_GATEWAY/STRIPE_SECRET_KEY/RAZORPAY_API_*
 *    Edge Function secrets). This is what finally lets Settings -> Payment
 *    Gateways actually drive live checkout instead of only the admin plan
 *    minting surface.
 *
 * 2. Per-tier Stripe price ids / RazorPay plan ids are resolved DB-first
 *    (the `plans` table's stripe_price_id/razorpay_plan_id columns, via
 *    lib/billing/plans.ts's resolveStripePriceId/resolveRazorpayPlanId),
 *    env-fallback (STRIPE_PRICE_STARTER etc / RAZORPAY_PLAN_STARTER etc) —
 *    the original read only the env vars.
 *
 * 3. A third gateway branch, PayPal, exists here that the original Deno
 *    checkout never had at all (see lib/billing/paypal.ts's file comment
 *    for why: PayPal was only ever wired into admin plan minting before
 *    this). Subscriptions use the PayPal Subscriptions API against
 *    `plans.paypal_plan_id` (DB-only — no legacy env var convention to
 *    fall back to); PAYG uses the PayPal Orders API. Both return an
 *    `approval_url` for the frontend to redirect the browser to (PayPal's
 *    hosted approval flow, analogous to Stripe's checkout_url) rather than
 *    RazorPay's embedded Checkout.js pattern. Unlike Orders (which requires
 *    an explicit capture call after buyer approval), subscriptions activate
 *    automatically on PayPal's side — both are driven to completion by
 *    routes/v1/billing/webhook-paypal.ts, not by the browser completing the
 *    return_url redirect (more reliable if the user closes the tab early).
 *
 * Rate limiting and CORS are NOT reimplemented here (unlike the Edge
 * Function, which had its own per-endpoint sliding-window rate limiter and
 * origin-aware CORS headers): this route is registered in server.ts behind
 * the same generateLimiter + global CORS middleware every other mutating
 * v1 route uses, which supersedes the bespoke per-function scheme the Edge
 * Functions needed on their own.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';
import { resolveActiveGatewayAndCredentials } from '../../../lib/billing/gateway-settings.js';
import {
  PAYG_PACKS,
  PAID_PLAN_SLUGS,
  isPaidPlanSlug,
  resolveStripePriceId,
  resolveRazorpayPlanId,
  resolvePaypalPlanId,
  addCalendarMonthsUTC,
} from '../../../lib/billing/plans.js';
import {
  createSubscription as createRazorpaySubscription,
  createOrder as createRazorpayOrder,
} from '../../../lib/billing/razorpay.js';
import {
  createSubscription as createPaypalSubscription,
  createOrder as createPaypalOrder,
  type PaypalCredentials,
} from '../../../lib/billing/paypal.js';
import { getInrToUsdRate, creditsToPaise } from '../../../lib/billing/currency.js';
import {
  createCustomer,
  updateCustomer,
  listSubscriptions,
  createSubscription as createStripeSubscription,
  updateSubscription as updateStripeSubscription,
  createCheckoutSession,
  listCheckoutSessions,
  StripeApiError,
  type StripeSubscription,
  type StripePaymentIntent,
  type StripeInvoice,
} from '../../../lib/billing/stripe.js';

// ── Request Validation ───────────────────────────────────────────────────────

interface CheckoutRequestBody {
  plan_tier?: string;
  payg_pack_id?: string;
  amount_cents?: number;
  dub_id?: string;
  embedded?: boolean;
  elements?: boolean;
  /** trial_months coupon code, applied only when plan_tier is also set (subscription checkout). */
  coupon_code?: string;
}

const VALID_PLAN_TIERS = new Set<string>(PAID_PLAN_SLUGS);
const VALID_PAYG_PACKS = new Set(Object.keys(PAYG_PACKS));

/** Minimum PAYG purchase: $50. */
const MIN_PAYG_AMOUNT_CENTS = 5_000;
/** Maximum PAYG purchase per single transaction: $5,000. */
const MAX_PAYG_AMOUNT_CENTS = 500_000;
/** Credits per cent (= 100 credits per USD). */
const CREDITS_PER_CENT = 1;

type ValidationResult =
  | { type: 'subscription'; plan_tier: string }
  | { type: 'payg'; pack_id: string }
  | { type: 'payg_dynamic'; amount_cents: number; credits: number }
  | { error: string };

function validateRequest(body: CheckoutRequestBody): ValidationResult {
  const hasPlan = body.plan_tier !== undefined && body.plan_tier !== null;
  const hasPack = body.payg_pack_id !== undefined && body.payg_pack_id !== null;
  const hasAmount = body.amount_cents !== undefined && body.amount_cents !== null;

  const specified = [hasPlan, hasPack, hasAmount].filter(Boolean).length;

  if (specified > 1) {
    return { error: 'Provide exactly one of plan_tier, payg_pack_id, or amount_cents' };
  }
  if (specified === 0) {
    return { error: 'Provide one of plan_tier, payg_pack_id, or amount_cents' };
  }

  if (hasPlan) {
    if (typeof body.plan_tier !== 'string') return { error: 'plan_tier must be a string' };
    if (!VALID_PLAN_TIERS.has(body.plan_tier)) {
      return { error: `Invalid plan_tier. Must be one of: ${[...VALID_PLAN_TIERS].join(', ')}` };
    }
    return { type: 'subscription', plan_tier: body.plan_tier };
  }

  if (hasPack) {
    if (typeof body.payg_pack_id !== 'string') return { error: 'payg_pack_id must be a string' };
    if (!VALID_PAYG_PACKS.has(body.payg_pack_id)) {
      return { error: `Invalid payg_pack_id. Must be one of: ${[...VALID_PAYG_PACKS].join(', ')}` };
    }
    return { type: 'payg', pack_id: body.payg_pack_id };
  }

  if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents)) {
    return { error: 'amount_cents must be an integer' };
  }
  if (body.amount_cents < MIN_PAYG_AMOUNT_CENTS) {
    return { error: `amount_cents must be at least ${MIN_PAYG_AMOUNT_CENTS} ($${MIN_PAYG_AMOUNT_CENTS / 100})` };
  }
  if (body.amount_cents > MAX_PAYG_AMOUNT_CENTS) {
    return { error: `amount_cents must be at most ${MAX_PAYG_AMOUNT_CENTS} ($${MAX_PAYG_AMOUNT_CENTS / 100})` };
  }
  return { type: 'payg_dynamic', amount_cents: body.amount_cents, credits: body.amount_cents * CREDITS_PER_CENT };
}

// ── Trial coupon resolution (shared by both gateways) ───────────────────────

interface TrialCouponInfo {
  couponCode: string;
  trialMonths: number;
}

/**
 * Validate a coupon code for checkout-time application. Read-only (calls
 * validate_coupon, never redeem_coupon) -- redemption happens once the
 * gateway actually confirms the trial (RazorPay: subscription.authenticated;
 * Stripe: checkout.session.completed landing on a trialing subscription),
 * not here, so an abandoned/failed checkout never burns the coupon. Only
 * trial_months coupons are checkout-applicable today -- percent_off/
 * fixed_off remain recorded-only, unchanged from before this feature.
 */
async function resolveTrialCoupon(
  userId: string,
  planTier: string,
  rawCode: string,
): Promise<{ error: string } | TrialCouponInfo> {
  const { data, error } = await supabase.rpc('validate_coupon', {
    p_code: rawCode,
    p_user_id: userId,
    p_plan_slug: planTier,
  });
  if (error) return { error: `Failed to validate coupon: ${error.message}` };

  const result = data as {
    valid: boolean;
    reason?: string;
    type?: string;
    trial_months?: number;
    coupon_code?: string;
  } | null;

  if (!result?.valid) {
    return { error: `Coupon is not valid${result?.reason ? ` (${result.reason})` : ''}` };
  }
  if (result.type !== 'trial_months') {
    return { error: 'Only trial coupons can be applied at checkout today' };
  }
  if (!result.trial_months || result.trial_months <= 0) {
    return { error: 'Coupon is missing a valid trial length' };
  }

  return { couponCode: result.coupon_code ?? rawCode.trim().toUpperCase(), trialMonths: result.trial_months };
}

// ── RazorPay Checkout ────────────────────────────────────────────────────────

/**
 * Read-then-write helper for the subscriptions row (no unique constraint
 * on subscriptions.user_id in this schema — only on
 * stripe_customer_id/stripe_subscription_id/razorpay_subscription_id).
 */
async function upsertSubscriptionRowForUser(
  userId: string,
  fields: Record<string, unknown>,
): Promise<{ id: string }> {
  const { data: existing, error: selectError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw new Error(`Failed to look up subscription row: ${selectError.message}`);

  if (existing) {
    const { error } = await supabase.from('subscriptions').update(fields).eq('id', existing.id);
    if (error) throw new Error(`Failed to update subscription row: ${error.message}`);
    return { id: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from('subscriptions')
    .insert({ user_id: userId, ...fields })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to insert subscription row: ${error.message}`);
  return inserted as { id: string };
}

async function createRazorpaySubscriptionCheckoutSession(
  creds: { keyId: string; keySecret: string },
  userId: string,
  userEmail: string,
  planTier: string,
  trialCoupon: TrialCouponInfo | undefined,
  res: Response,
): Promise<void> {
  const planId = await resolveRazorpayPlanId(supabase, planTier);
  if (!planId) {
    res.status(500).json({
      error: 'configuration_error',
      error_description: `RazorPay Plan ID not configured for plan: ${planTier}`,
    });
    return;
  }

  const { data: existingSub, error: existingError } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .eq('payment_gateway', 'razorpay')
    .not('razorpay_subscription_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing RazorPay subscription:', existingError.message);
  } else if (existingSub && existingSub.status !== 'canceled' && existingSub.status !== 'expired') {
    // Broadened from the original active/trialing-only check: a trial
    // subscription sits in 'unpaid' between creation and the customer
    // completing RazorPay's mandate authentication (subscription.authenticated),
    // so a double-submitted checkout in that window must also be rejected,
    // not just once the subscription is already active/trialing.
    res.status(409).json({
      error: 'subscription_pending',
      error_description: 'You already have a subscription in progress. Cancel it, or wait for it to finish processing, before subscribing again.',
    });
    return;
  }

  // trial_months coupon: defer the real first charge via RazorPay's native
  // start_at mechanism. The customer authorizes/sets up the mandate now
  // (subscription.authenticated fires); the actual charge only happens
  // when startAt arrives (subscription.charged/activated). See
  // webhook-razorpay.ts for how subscription.authenticated activates the
  // trial (status/credits/redemption) for a coupon-bearing subscription.
  const startAt = trialCoupon
    ? addCalendarMonthsUTC(Math.floor(Date.now() / 1000), trialCoupon.trialMonths)
    : undefined;

  let subscription;
  try {
    subscription = await createRazorpaySubscription(creds, {
      planId,
      startAt,
      notes: {
        user_id: userId,
        plan_tier: planTier,
        user_email: userEmail,
        ...(trialCoupon ? { coupon_code: trialCoupon.couponCode } : {}),
      },
    });
  } catch (err) {
    console.error('Failed to create RazorPay subscription:', err);
    res.status(502).json({
      error: 'razorpay_error',
      error_description: err instanceof Error ? err.message : 'Failed to create subscription',
    });
    return;
  }

  try {
    await upsertSubscriptionRowForUser(userId, {
      payment_gateway: 'razorpay',
      razorpay_subscription_id: subscription.id,
      razorpay_plan_id: planId,
      status: 'unpaid',
      ...(trialCoupon ? { coupon_code: trialCoupon.couponCode } : {}),
    });
  } catch (err) {
    console.error('Failed to record RazorPay subscription row:', err);
  }

  res.status(200).json({
    payment_gateway: 'razorpay',
    razorpay_subscription_id: subscription.id,
    razorpay_key_id: creds.keyId,
    plan_tier: planTier,
    short_url: subscription.short_url,
    ...(trialCoupon ? { trial_months: trialCoupon.trialMonths } : {}),
  });
}

async function createRazorpayPaygOrder(
  creds: { keyId: string; keySecret: string },
  userId: string,
  credits: number,
  packId: string | null,
  res: Response,
): Promise<void> {
  let inrRate: number;
  try {
    inrRate = await getInrToUsdRate(supabase);
  } catch (err) {
    console.error('RazorPay PAYG: failed to read INR exchange rate:', err);
    res.status(500).json({
      error: 'configuration_error',
      error_description: 'INR is not configured for charging yet -- set/activate its exchange rate in Settings -> Currency.',
    });
    return;
  }

  const amountPaise = creditsToPaise(credits, inrRate);

  let order;
  try {
    order = await createRazorpayOrder(creds, {
      amountPaise,
      currency: 'INR',
      receipt: `payg_${userId.slice(0, 8)}_${Date.now()}`,
      notes: { user_id: userId, credits: String(credits), ...(packId ? { pack_id: packId } : {}) },
    });
  } catch (err) {
    console.error('Failed to create RazorPay order:', err);
    res.status(502).json({
      error: 'razorpay_error',
      error_description: err instanceof Error ? err.message : 'Failed to create order',
    });
    return;
  }

  res.status(200).json({
    payment_gateway: 'razorpay',
    razorpay_order_id: order.id,
    razorpay_key_id: creds.keyId,
    amount_paise: amountPaise,
    currency: 'INR',
    credits,
  });
}

async function handleRazorpayCheckout(
  creds: { keyId: string; keySecret: string },
  validation: ValidationResult,
  userId: string,
  userEmail: string,
  trialCoupon: TrialCouponInfo | undefined,
  res: Response,
): Promise<void> {
  if ('error' in validation) {
    res.status(400).json({ error: 'invalid_request', error_description: validation.error });
    return;
  }

  if (validation.type === 'subscription') {
    return createRazorpaySubscriptionCheckoutSession(creds, userId, userEmail, validation.plan_tier, trialCoupon, res);
  }
  if (validation.type === 'payg_dynamic') {
    return createRazorpayPaygOrder(creds, userId, validation.credits, null, res);
  }
  const pack = PAYG_PACKS[validation.pack_id];
  if (!pack) {
    res.status(400).json({ error: 'invalid_pack', error_description: `Unknown PAYG pack: ${validation.pack_id}` });
    return;
  }
  return createRazorpayPaygOrder(creds, userId, pack.credits, validation.pack_id, res);
}

// ── PayPal Checkout ──────────────────────────────────────────────────────────

async function createPaypalSubscriptionCheckoutSession(
  creds: PaypalCredentials,
  userId: string,
  planTier: string,
  res: Response,
): Promise<void> {
  const planId = await resolvePaypalPlanId(supabase, planTier);
  if (!planId) {
    res.status(500).json({
      error: 'configuration_error',
      error_description: `PayPal Plan ID not configured for plan: ${planTier} -- sync plans in Settings -> Payment Gateways first`,
    });
    return;
  }

  const { data: existingSub, error: existingError } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .eq('payment_gateway', 'paypal')
    .not('paypal_subscription_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing PayPal subscription:', existingError.message);
  } else if (existingSub && (existingSub.status === 'active' || existingSub.status === 'trialing')) {
    res.status(409).json({
      error: 'subscription_pending',
      error_description: 'You already have an active subscription. Cancel it before subscribing to a different plan.',
    });
    return;
  }

  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  let subscription;
  try {
    subscription = await createPaypalSubscription(creds, {
      planId,
      customId: userId,
      returnUrl: `${siteUrl}/billing?status=success&type=subscription&paypal=1`,
      cancelUrl: `${siteUrl}/billing?status=canceled`,
    });
  } catch (err) {
    console.error('Failed to create PayPal subscription:', err);
    res.status(502).json({
      error: 'paypal_error',
      error_description: err instanceof Error ? err.message : 'Failed to create subscription',
    });
    return;
  }

  if (!subscription.approvalUrl) {
    res.status(500).json({ error: 'paypal_error', error_description: 'PayPal did not return an approval URL' });
    return;
  }

  try {
    await upsertSubscriptionRowForUser(userId, {
      payment_gateway: 'paypal',
      paypal_subscription_id: subscription.id,
      status: 'unpaid',
    });
  } catch (err) {
    console.error('Failed to record PayPal subscription row:', err);
  }

  res.status(200).json({
    payment_gateway: 'paypal',
    paypal_subscription_id: subscription.id,
    approval_url: subscription.approvalUrl,
    plan_tier: planTier,
  });
}

/**
 * Create a PayPal Order for a PAYG credit top-up (fixed pack or dynamic
 * amount). Unlike Stripe/RazorPay, PayPal Orders carry only two small
 * per-purchase-unit metadata slots (custom_id, reference_id) rather than an
 * open metadata bag -- custom_id holds the user id (matching the
 * subscription path's convention, and what webhook-paypal.ts correlates
 * on), reference_id holds a compact `credits:packId` encoding so the
 * capture/webhook handler can grant the right amount without a DB lookup.
 */
async function createPaypalPaygOrder(
  creds: PaypalCredentials,
  userId: string,
  credits: number,
  amountUsd: number,
  packId: string | null,
  res: Response,
): Promise<void> {
  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  let order;
  try {
    order = await createPaypalOrder(creds, {
      amountUsd,
      customId: userId,
      referenceId: `${credits}:${packId ?? 'dynamic'}`,
      returnUrl: `${siteUrl}/billing?status=success&type=payg&paypal=1`,
      cancelUrl: `${siteUrl}/billing?status=canceled`,
      description: packId ? `PAYG credit purchase: ${credits} credits (${packId})` : `PAYG credit purchase: ${credits} credits (dynamic)`,
    });
  } catch (err) {
    console.error('Failed to create PayPal order:', err);
    res.status(502).json({
      error: 'paypal_error',
      error_description: err instanceof Error ? err.message : 'Failed to create order',
    });
    return;
  }

  if (!order.approvalUrl) {
    res.status(500).json({ error: 'paypal_error', error_description: 'PayPal did not return an approval URL' });
    return;
  }

  res.status(200).json({
    payment_gateway: 'paypal',
    paypal_order_id: order.id,
    approval_url: order.approvalUrl,
    amount_usd: amountUsd,
    credits,
  });
}

async function handlePaypalCheckout(
  creds: PaypalCredentials,
  validation: ValidationResult,
  userId: string,
  res: Response,
): Promise<void> {
  if ('error' in validation) {
    res.status(400).json({ error: 'invalid_request', error_description: validation.error });
    return;
  }

  if (validation.type === 'subscription') {
    return createPaypalSubscriptionCheckoutSession(creds, userId, validation.plan_tier, res);
  }
  if (validation.type === 'payg_dynamic') {
    return createPaypalPaygOrder(creds, userId, validation.credits, validation.amount_cents / 100, null, res);
  }
  const pack = PAYG_PACKS[validation.pack_id];
  if (!pack) {
    res.status(400).json({ error: 'invalid_pack', error_description: `Unknown PAYG pack: ${validation.pack_id}` });
    return;
  }
  return createPaypalPaygOrder(creds, userId, pack.credits, pack.priceUsd, validation.pack_id, res);
}

// ── Stripe Checkout ──────────────────────────────────────────────────────────

async function getOrCreateStripeCustomer(secretKey: string, userId: string, userEmail: string): Promise<string> {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscription?.stripe_customer_id) return subscription.stripe_customer_id;

  const customer = await createCustomer(secretKey, { email: userEmail, metadata: { supabase_user_id: userId } });

  const { error: upsertError } = await supabase
    .from('subscriptions')
    .upsert(
      { user_id: userId, stripe_customer_id: customer.id, plan_slug: 'free', status: 'active' },
      { onConflict: 'user_id', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (upsertError) {
    await supabase
      .from('subscriptions')
      .update({ stripe_customer_id: customer.id })
      .eq('user_id', userId)
      .is('stripe_customer_id', null);
  }

  return customer.id;
}

async function handleSubscriptionUpdate(
  secretKey: string,
  subscription: StripeSubscription,
  priceId: string,
  planTier: string,
  userId: string,
  res: Response,
): Promise<void> {
  const currentItem = subscription.items.data[0];
  if (!currentItem) {
    res.status(500).json({ error: 'stripe_error', error_description: 'Existing subscription has no items' });
    return;
  }

  if (currentItem.price.id === priceId) {
    if (subscription.cancel_at_period_end) {
      const reactivated = await updateStripeSubscription(secretKey, subscription.id, { cancel_at_period_end: false });
      await supabase
        .from('subscriptions')
        .update({ status: reactivated.status, cancel_at_period_end: false })
        .eq('user_id', userId);
      res.status(200).json({ upgraded: true, plan_tier: planTier, status: reactivated.status, reactivated: true });
      return;
    }
    res.status(400).json({ error: 'already_subscribed', error_description: 'You are already on this plan' });
    return;
  }

  try {
    const updated = await updateStripeSubscription(secretKey, subscription.id, {
      items: [{ id: currentItem.id, price: priceId }],
      proration_behavior: 'always_invoice',
      metadata: { user_id: userId, plan_tier: planTier },
    });

    await supabase
      .from('subscriptions')
      .update({
        plan_slug: planTier,
        stripe_customer_id: typeof updated.customer === 'string' ? updated.customer : updated.customer?.id,
        stripe_subscription_id: updated.id,
        stripe_price_id: priceId,
        status: updated.status,
        cancel_at_period_end: updated.cancel_at_period_end,
      })
      .eq('user_id', userId);

    const PLAN_CREDITS: Record<string, number> = { starter: 3900, creator: 6900, pro_plus: 12900 };
    const newCredits = PLAN_CREDITS[planTier];
    if (newCredits) {
      const { data: currentCredits } = await supabase
        .from('user_credits')
        .select('id, monthly_credits_remaining')
        .eq('user_id', userId)
        .maybeSingle();

      const current = currentCredits?.monthly_credits_remaining ?? 0;
      if (!currentCredits) {
        await supabase.from('user_credits').insert({ user_id: userId, monthly_credits_remaining: newCredits, purchased_balance: 0 });
      } else if (newCredits > current) {
        await supabase.from('user_credits').update({ monthly_credits_remaining: newCredits }).eq('user_id', userId);
      }
    }

    res.status(200).json({ upgraded: true, plan_tier: planTier, status: updated.status });
  } catch (err) {
    console.error('Stripe subscription update failed:', err);
    res.status(500).json({
      error: 'stripe_error',
      error_description: err instanceof Error ? err.message : 'Subscription update failed',
    });
  }
}

async function createSubscriptionCheckout(
  secretKey: string,
  customerId: string,
  userId: string,
  planTier: string,
  body: CheckoutRequestBody | undefined,
  trialCoupon: TrialCouponInfo | undefined,
  res: Response,
): Promise<void> {
  const priceId = await resolveStripePriceId(supabase, planTier);
  if (!priceId) {
    res.status(500).json({ error: 'configuration_error', error_description: `Stripe price not configured for plan: ${planTier}` });
    return;
  }

  try {
    for (const status of ['active', 'trialing', 'incomplete', 'past_due'] as const) {
      const subs = await listSubscriptions(secretKey, { customer: customerId, status, limit: 1 });
      const sub = subs.data[0];
      if (sub) {
        if (status === 'active' || status === 'trialing') {
          return await handleSubscriptionUpdate(secretKey, sub, priceId, planTier, userId, res);
        }
        res.status(409).json({
          error: 'subscription_pending',
          error_description: 'You already have a pending subscription. Please wait a moment and refresh the page.',
        });
        return;
      }
    }

    const recentSessions = await listCheckoutSessions(secretKey, { customer: customerId, limit: 5 });
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const pendingSession = recentSessions.data.find(
      (s) => s.status === 'open' && (s.created ?? 0) > tenMinutesAgo && s.mode === 'subscription',
    );
    if (pendingSession?.url) {
      res.status(200).json({ checkout_url: pendingSession.url, session_id: pendingSession.id });
      return;
    }
  } catch (err) {
    console.error('Error checking existing subscriptions:', err);
  }

  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const isEmbedded = body?.embedded === true;
  const isElements = body?.elements === true;

  if (isElements) {
    if (trialCoupon) {
      res.status(400).json({
        error: 'invalid_coupon',
        error_description: 'Trial coupons are not supported with embedded checkout yet -- use the hosted checkout flow.',
      });
      return;
    }
    const subscription = await createStripeSubscription(secretKey, {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: { user_id: userId, plan_tier: planTier },
      expand: ['latest_invoice.payment_intent'],
    });

    const invoice = subscription.latest_invoice as StripeInvoice;
    const paymentIntent = invoice?.payment_intent as StripePaymentIntent | undefined;

    if (!paymentIntent?.client_secret) {
      res.status(500).json({ error: 'stripe_error', error_description: 'No payment intent created' });
      return;
    }

    res.status(200).json({ client_secret: paymentIntent.client_secret, subscription_id: subscription.id });
    return;
  }

  const subscriptionMetadata: Record<string, string> = { user_id: userId, plan_tier: planTier };
  if (trialCoupon) subscriptionMetadata.coupon_code = trialCoupon.couponCode;

  const sessionParams: Record<string, unknown> = {
    customer: customerId,
    mode: 'subscription',
    currency: 'usd',
    locale: 'en',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { user_id: userId, plan_tier: planTier, checkout_type: 'subscription', dubCustomerExternalId: userId },
    subscription_data: {
      metadata: subscriptionMetadata,
      // "Legacy" free-trial mechanism -- Stripe's newer Trial Offer API is
      // explicitly NOT supported by Checkout Sessions (per Stripe's own
      // docs), so trial_end is the correct/only lever here.
      ...(trialCoupon
        ? { trial_end: addCalendarMonthsUTC(Math.floor(Date.now() / 1000), trialCoupon.trialMonths) }
        : {}),
    },
    // So webhook-stripe.ts's checkout.session.completed handler can read
    // the real subscription status/trial_end instead of assuming 'active'
    // (see that file: it previously hardcoded status:'active', which
    // would have silently clobbered a genuine 'trialing' status).
    expand: ['subscription'],
  };

  if (isEmbedded) {
    sessionParams.ui_mode = 'embedded';
    sessionParams.return_url = `${siteUrl}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`;
  } else {
    sessionParams.success_url = `${siteUrl}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`;
    sessionParams.cancel_url = `${siteUrl}/billing?status=canceled`;
  }

  const session = await createCheckoutSession(secretKey, sessionParams);

  if (isEmbedded) {
    res.status(200).json({ client_secret: session.client_secret, session_id: session.id });
    return;
  }

  if (!session.url) {
    res.status(500).json({ error: 'stripe_error', error_description: 'Stripe did not return a checkout URL' });
    return;
  }

  res.status(200).json({ checkout_url: session.url, session_id: session.id });
}

/**
 * PAYG checkout via Stripe -- unlike the original (which required a
 * pre-created Stripe Price object per pack, STRIPE_PRICE_PAYG_3900), this
 * always uses inline `price_data` (the same mechanism the dynamic-amount
 * path below already used), so a self-hosted admin doesn't need to create
 * a Stripe Price object for the one fixed pack. Same amount charged, same
 * credits granted -- purely a configuration simplification.
 */
async function createPaygCheckout(
  secretKey: string,
  customerId: string,
  userId: string,
  packId: string,
  res: Response,
): Promise<void> {
  const pack = PAYG_PACKS[packId];
  if (!pack) {
    res.status(400).json({ error: 'invalid_pack', error_description: `Unknown PAYG pack: ${packId}` });
    return;
  }

  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  const session = await createCheckoutSession(secretKey, {
    customer: customerId,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: pack.packId, description: 'Pay-as-you-go credit top-up. Credits never expire.' },
          unit_amount: Math.round(pack.priceUsd * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/billing?session_id={CHECKOUT_SESSION_ID}&status=success&type=payg`,
    cancel_url: `${siteUrl}/billing?status=canceled`,
    metadata: { user_id: userId, pack_id: packId, credits: String(pack.credits), checkout_type: 'payg', dubCustomerExternalId: userId },
    payment_intent_data: { metadata: { user_id: userId, pack_id: packId, credits: String(pack.credits) } },
  });

  if (!session.url) {
    res.status(500).json({ error: 'stripe_error', error_description: 'Stripe did not return a checkout URL' });
    return;
  }

  res.status(200).json({ checkout_url: session.url, session_id: session.id });
}

async function createDynamicPaygCheckout(
  secretKey: string,
  customerId: string,
  userId: string,
  amountCents: number,
  credits: number,
  res: Response,
): Promise<void> {
  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  const session = await createCheckoutSession(secretKey, {
    customer: customerId,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${credits.toLocaleString('en-US')} vantly-ugc credits`, description: 'Pay-as-you-go credit top-up. Credits never expire.' },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: `${siteUrl}/billing?session_id={CHECKOUT_SESSION_ID}&status=success&type=payg`,
    cancel_url: `${siteUrl}/billing?status=canceled`,
    metadata: { user_id: userId, credits: String(credits), amount_cents: String(amountCents), checkout_type: 'payg', dubCustomerExternalId: userId },
    payment_intent_data: {
      setup_future_usage: 'off_session',
      metadata: { user_id: userId, credits: String(credits), amount_cents: String(amountCents) },
    },
  });

  if (!session.url) {
    res.status(500).json({ error: 'stripe_error', error_description: 'Stripe did not return a checkout URL' });
    return;
  }

  res.status(200).json({ checkout_url: session.url, session_id: session.id, credits, amount_cents: amountCents });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

export async function checkoutRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  const userEmail = (req as { userEmail?: string }).userEmail ?? '';
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }

  const body = req.body as CheckoutRequestBody;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'invalid_request', error_description: 'Request body must be valid JSON' });
    return;
  }

  const validation = validateRequest(body);
  if ('error' in validation) {
    res.status(400).json({ error: 'invalid_request', error_description: validation.error });
    return;
  }

  if (validation.type === 'subscription' && !isPaidPlanSlug(validation.plan_tier)) {
    res.status(400).json({ error: 'invalid_request', error_description: `Unknown plan tier: ${validation.plan_tier}` });
    return;
  }

  let trialCoupon: TrialCouponInfo | undefined;
  if (validation.type === 'subscription' && body.coupon_code) {
    const couponResult = await resolveTrialCoupon(userId, validation.plan_tier, body.coupon_code);
    if ('error' in couponResult) {
      res.status(400).json({ error: 'invalid_coupon', error_description: couponResult.error });
      return;
    }
    trialCoupon = couponResult;
  }

  let resolved;
  try {
    resolved = await resolveActiveGatewayAndCredentials(supabase);
  } catch (err) {
    console.error('Failed to resolve payment gateway settings:', err);
    res.status(500).json({ error: 'server_error', error_description: 'Failed to resolve payment gateway configuration' });
    return;
  }

  if (resolved.gateway === 'razorpay') {
    if (!resolved.razorpay.keyId || !resolved.razorpay.keySecret) {
      res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
      return;
    }
    await handleRazorpayCheckout(
      { keyId: resolved.razorpay.keyId, keySecret: resolved.razorpay.keySecret },
      validation,
      userId,
      userEmail,
      trialCoupon,
      res,
    );
    return;
  }

  if (resolved.gateway === 'paypal') {
    if (trialCoupon) {
      res.status(400).json({
        error: 'invalid_coupon',
        error_description: 'Trial coupons are only supported with Stripe or RazorPay checkout today.',
      });
      return;
    }
    if (!resolved.paypal.clientId || !resolved.paypal.clientSecret) {
      res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
      return;
    }
    await handlePaypalCheckout(
      { clientId: resolved.paypal.clientId, clientSecret: resolved.paypal.clientSecret, mode: resolved.paypal.mode },
      validation,
      userId,
      res,
    );
    return;
  }

  // Stripe branch
  const secretKey = resolved.stripe.secretKey;
  if (!secretKey) {
    res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
    return;
  }

  let customerId: string;
  try {
    customerId = await getOrCreateStripeCustomer(secretKey, userId, userEmail);
  } catch (err) {
    console.error('Failed to get/create Stripe customer:', err);
    res.status(500).json({ error: 'stripe_error', error_description: 'Failed to initialize customer record' });
    return;
  }

  if (body.dub_id) {
    try {
      await updateCustomer(secretKey, customerId, { metadata: { dubCustomerExternalId: userId, dubClickId: body.dub_id } as unknown as Record<string, string> });
    } catch (err) {
      console.error('Failed to attach dub metadata to Stripe customer:', err);
    }
  }

  try {
    if (validation.type === 'subscription') {
      await createSubscriptionCheckout(secretKey, customerId, userId, validation.plan_tier, body, trialCoupon, res);
      return;
    }
    if (validation.type === 'payg_dynamic') {
      await createDynamicPaygCheckout(secretKey, customerId, userId, validation.amount_cents, validation.credits, res);
      return;
    }
    await createPaygCheckout(secretKey, customerId, userId, validation.pack_id, res);
  } catch (err) {
    console.error('Unhandled error in checkout:', err);
    if (err instanceof StripeApiError) {
      res.status(err.status || 500).json({ error: 'stripe_error', error_description: err.message, stripe_code: err.code });
      return;
    }
    res.status(500).json({ error: 'server_error', error_description: err instanceof Error ? err.message : 'Internal server error' });
  }
}
