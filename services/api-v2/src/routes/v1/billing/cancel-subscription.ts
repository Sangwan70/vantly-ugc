// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/cancel-subscription — cancel the user's subscription at
 * period end (they keep access until the current billing period expires).
 *
 * Ported from supabase/functions/cancel-subscription (a Supabase Edge
 * Function) — see checkout.ts's file comment for why this self-hosted
 * deployment needs api-v2 routes instead of Edge Functions.
 *
 * Unlike checkout.ts, gateway choice here is NOT the admin's
 * payment_gateway_settings.active_gateway (that's which gateway new
 * checkouts use) — it's whichever gateway the user's own subscription row
 * already belongs to (subscriptions.payment_gateway), same as the
 * original. Credentials for that gateway are still resolved DB-first/
 * env-fallback via gateway-settings.ts.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';
import { resolveStripeCredentials, resolveRazorpayCredentials, resolvePaypalCredentials, getPaymentGatewaySettingsRow } from '../../../lib/billing/gateway-settings.js';
import { listSubscriptions, updateSubscription } from '../../../lib/billing/stripe.js';
import { cancelSubscription as cancelRazorpaySubscription } from '../../../lib/billing/razorpay.js';
import { cancelSubscription as cancelPaypalSubscription } from '../../../lib/billing/paypal.js';

async function handleCancelStripe(userId: string, stripeCustomerId: string | null, res: Response): Promise<void> {
  if (!stripeCustomerId) {
    res.status(400).json({ error: 'no_subscription', error_description: 'No active subscription found' });
    return;
  }

  const row = await getPaymentGatewaySettingsRow(supabase);
  const { secretKey } = resolveStripeCredentials(row);
  if (!secretKey) {
    res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
    return;
  }

  const subs = await listSubscriptions(secretKey, { customer: stripeCustomerId, status: 'active', limit: 1 });
  let stripeSub = subs.data[0];
  if (!stripeSub) {
    const trialSubs = await listSubscriptions(secretKey, { customer: stripeCustomerId, status: 'trialing', limit: 1 });
    stripeSub = trialSubs.data[0];
  }
  if (!stripeSub) {
    res.status(400).json({ error: 'no_subscription', error_description: 'No active Stripe subscription found' });
    return;
  }

  const updated = await updateSubscription(secretKey, stripeSub.id, { cancel_at_period_end: true });
  const periodEndIso = new Date((updated.current_period_end ?? 0) * 1000).toISOString();

  await supabase
    .from('subscriptions')
    .update({ cancel_at_period_end: true, current_period_end: periodEndIso })
    .eq('user_id', userId);

  res.status(200).json({ canceled: true, cancel_at: periodEndIso });
}

async function handleCancelRazorpay(userId: string, razorpaySubscriptionId: string | null, res: Response): Promise<void> {
  if (!razorpaySubscriptionId) {
    res.status(400).json({ error: 'no_subscription', error_description: 'No active subscription found' });
    return;
  }

  const row = await getPaymentGatewaySettingsRow(supabase);
  const creds = resolveRazorpayCredentials(row);
  if (!creds.keyId || !creds.keySecret) {
    res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
    return;
  }

  let periodEndIso: string | null = null;
  try {
    const updated = await cancelRazorpaySubscription({ keyId: creds.keyId, keySecret: creds.keySecret }, razorpaySubscriptionId, true);
    periodEndIso = updated.current_end ? new Date((updated.current_end as number) * 1000).toISOString() : null;
  } catch (err) {
    const alreadyEnded = err instanceof Error && /already|cancel|complet|expir/i.test(err.message);
    if (!alreadyEnded) {
      console.error('RazorPay cancel failed:', err);
      res.status(502).json({
        error: 'razorpay_error',
        error_description: err instanceof Error ? err.message : 'Failed to cancel subscription',
      });
      return;
    }
    console.warn(`RazorPay subscription ${razorpaySubscriptionId} was already cancelled/completed -- treating as success`);
  }

  const update: Record<string, unknown> = { cancel_at_period_end: true };
  if (periodEndIso) update.current_period_end = periodEndIso;
  await supabase.from('subscriptions').update(update).eq('user_id', userId);

  res.status(200).json({ canceled: true, cancel_at: periodEndIso });
}

async function handleCancelPaypal(userId: string, paypalSubscriptionId: string | null, res: Response): Promise<void> {
  if (!paypalSubscriptionId) {
    res.status(400).json({ error: 'no_subscription', error_description: 'No active subscription found' });
    return;
  }

  const row = await getPaymentGatewaySettingsRow(supabase);
  const creds = resolvePaypalCredentials(row);
  if (!creds.clientId || !creds.clientSecret) {
    res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
    return;
  }

  try {
    await cancelPaypalSubscription(
      { clientId: creds.clientId, clientSecret: creds.clientSecret, mode: creds.mode },
      paypalSubscriptionId,
      'Cancelled by customer',
    );
  } catch (err) {
    // PayPal returns 422 for an already-cancelled/suspended/expired subscription -- treat as a no-op, same as RazorPay above.
    const alreadyEnded = err instanceof Error && /already|cancel|complet|expir|suspend/i.test(err.message);
    if (!alreadyEnded) {
      console.error('PayPal cancel failed:', err);
      res.status(502).json({
        error: 'paypal_error',
        error_description: err instanceof Error ? err.message : 'Failed to cancel subscription',
      });
      return;
    }
    console.warn(`PayPal subscription ${paypalSubscriptionId} was already cancelled -- treating as success`);
  }

  // PayPal's cancel call has no response body carrying a period-end date;
  // the BILLING.SUBSCRIPTION.CANCELLED webhook (webhook-paypal.ts) is the
  // source of truth for final status -- this just flags cancellation intent.
  await supabase.from('subscriptions').update({ cancel_at_period_end: true }).eq('user_id', userId);

  res.status(200).json({ canceled: true, cancel_at: null });
}

export async function cancelSubscriptionRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }

  try {
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('payment_gateway, stripe_customer_id, razorpay_subscription_id, paypal_subscription_id')
      .eq('user_id', userId)
      .or('stripe_customer_id.not.is.null,razorpay_subscription_id.not.is.null,paypal_subscription_id.not.is.null')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError || !subscription) {
      res.status(400).json({ error: 'no_subscription', error_description: 'No active subscription found' });
      return;
    }

    if (subscription.payment_gateway === 'razorpay') {
      await handleCancelRazorpay(userId, subscription.razorpay_subscription_id, res);
      return;
    }
    if (subscription.payment_gateway === 'paypal') {
      await handleCancelPaypal(userId, subscription.paypal_subscription_id, res);
      return;
    }
    await handleCancelStripe(userId, subscription.stripe_customer_id, res);
  } catch (err) {
    console.error('Unhandled error in cancel-subscription:', err);
    res.status(500).json({ error: 'server_error', error_description: err instanceof Error ? err.message : 'Internal server error' });
  }
}
