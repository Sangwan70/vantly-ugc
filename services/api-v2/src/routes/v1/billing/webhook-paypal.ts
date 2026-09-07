// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/webhooks/paypal — receives and processes PayPal webhook
 * events for subscription billing and PAYG credit top-ups.
 *
 * Unlike webhook-stripe.ts/webhook-razorpay.ts, this isn't a port of an
 * existing Deno Edge Function -- PayPal checkout/webhooks were never built
 * anywhere in this codebase before (see checkout.ts's file comment and
 * lib/billing/paypal.ts's file comment). Structured the same way as the
 * other two regardless (verify -> dedup -> route -> dead-letter) for
 * consistency. Called directly by PayPal's servers (not proxied through
 * apps/web, and NOT behind authMiddleware — the webhook signature IS the
 * auth), so configure this URL as a webhook subscription in the PayPal
 * Developer Dashboard for the events listed below:
 * https://<api-v2-host>/v1/billing/webhooks/paypal
 *
 * Requires `req.rawBody` (a Buffer of the exact bytes PayPal sent) — see
 * server.ts's express.json({ verify }) callback (shared with
 * webhook-stripe.ts/webhook-razorpay.ts).
 *
 * Verification: unlike Stripe/RazorPay's local HMAC verification, PayPal
 * webhooks are verified by calling PayPal's own
 * /v1/notifications/verify-webhook-signature endpoint (lib/billing/paypal.ts's
 * verifyPaypalWebhookSignature) -- this needs API credentials (any valid
 * client id/secret for the account the webhook belongs to) AND a
 * PAYPAL_WEBHOOK_ID (created alongside the webhook subscription in the
 * Developer Dashboard; stays env-only, same reasoning as
 * STRIPE_WEBHOOK_SECRET/RAZORPAY_WEBHOOK_SECRET -- payment_gateway_settings
 * only stores API credentials, not per-webhook-endpoint ids).
 *
 * Idempotency: PayPal DOES send a stable event id (unlike RazorPay), so
 * dedup here is keyed directly on it, same as Stripe.
 *
 * Handled event types:
 *   - CHECKOUT.ORDER.APPROVED           (PAYG: capture the order server-side
 *                                        the moment the buyer approves,
 *                                        rather than waiting on the browser
 *                                        to complete the return_url redirect)
 *   - PAYMENT.CAPTURE.COMPLETED         (PAYG: grant credits -- belt-and-
 *                                        suspenders backup to the capture
 *                                        above, both idempotent on capture id)
 *   - BILLING.SUBSCRIPTION.ACTIVATED    (initial credit grant)
 *   - PAYMENT.SALE.COMPLETED            (subscription renewal -- reset
 *                                        monthly credits; gated on
 *                                        resource.billing_agreement_id
 *                                        being present, i.e. this sale is
 *                                        tied to a subscription, not a
 *                                        stray one-off Payments-API sale)
 *   - BILLING.SUBSCRIPTION.CANCELLED / .EXPIRED / .SUSPENDED
 *                                        (downgrade to free, credits preserved)
 */

import type { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { supabase } from '../../../server.js';
import { getPaymentGatewaySettingsRow, resolvePaypalCredentials } from '../../../lib/billing/gateway-settings.js';
import {
  verifyPaypalWebhookSignature,
  getOrder,
  captureOrder,
  type PaypalCredentials,
  type PaypalWebhookEvent,
} from '../../../lib/billing/paypal.js';
import { PLANS, resolvePlanByPaypalPlanId } from '../../../lib/billing/plans.js';

// ─── Idempotency ────────────────────────────────────────────────────────────

async function isEventAlreadyProcessed(paypalEventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('paypal_webhook_events')
    .select('paypal_event_id, processed_at')
    .eq('paypal_event_id', paypalEventId)
    .maybeSingle();

  if (error) {
    console.error('Error checking PayPal event idempotency:', error.message);
    return false;
  }
  return !!data?.processed_at;
}

async function recordEventStart(eventId: string, eventType: string, payload: unknown): Promise<void> {
  const { error } = await supabase
    .from('paypal_webhook_events')
    .upsert({ paypal_event_id: eventId, event_type: eventType, processed_at: null, payload }, { onConflict: 'paypal_event_id' });
  if (error) console.error('Failed to record PayPal event start:', error.message);
}

async function recordEventComplete(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('paypal_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('paypal_event_id', eventId);
  if (error) console.error('Failed to mark PayPal event complete:', error.message);
}

async function deadLetter(payload: unknown, errorMessage: string): Promise<void> {
  const { error } = await supabase.from('dead_letter_webhooks').insert({
    provider_slug: 'paypal',
    payload: payload as Record<string, unknown>,
    error_message: errorMessage,
    status: 'pending',
    next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) console.error('Failed to insert PayPal dead letter:', error.message);
}

// ─── Subscription row resolution ───────────────────────────────────────────

interface SubRow {
  id: string;
  user_id: string;
  plan_slug: string;
}

async function resolveSubscriptionRow(paypalSubscriptionId: string, customId: string | undefined): Promise<SubRow | null> {
  const { data: byId, error: byIdError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan_slug')
    .eq('paypal_subscription_id', paypalSubscriptionId)
    .maybeSingle();

  if (byIdError) throw new Error(`subscription lookup failed: ${byIdError.message}`);
  if (byId) return byId as SubRow;

  const userId = customId;
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
    .update({ paypal_subscription_id: paypalSubscriptionId, payment_gateway: 'paypal' })
    .eq('id', byUser.id);

  return byUser as SubRow;
}

// ─── Subscription event handlers ───────────────────────────────────────────

async function handleSubscriptionActivated(resource: Record<string, unknown>): Promise<void> {
  const paypalSubscriptionId = resource.id as string;
  const customId = resource.custom_id as string | undefined;
  const planId = resource.plan_id as string | undefined;

  const subRecord = await resolveSubscriptionRow(paypalSubscriptionId, customId);
  if (!subRecord) {
    console.warn(`BILLING.SUBSCRIPTION.ACTIVATED: no local record resolvable for ${paypalSubscriptionId} — acknowledging without action`);
    return;
  }

  const userId = subRecord.user_id;

  const planFromId = planId ? await resolvePlanByPaypalPlanId(supabase, planId) : undefined;
  const plan = planFromId ?? PLANS[subRecord.plan_slug];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;

  const subUpdate: Record<string, unknown> = {
    status: 'active',
    cancel_at_period_end: false,
    payment_gateway: 'paypal',
    paypal_subscription_id: paypalSubscriptionId,
  };
  if (plan?.slug) subUpdate.plan_slug = plan.slug;

  const { error: updateError } = await supabase.from('subscriptions').update(subUpdate).eq('id', subRecord.id);
  if (updateError) console.error('Failed to update PayPal subscription record:', updateError.message);

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
      description: `Initial credit allocation for ${plan?.slug ?? 'unknown'} plan (PayPal)`,
    });

    console.log(`PayPal: initialized ${monthlyAllowance} credits for user ${userId}`);
  } else {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('reset_monthly_credits', {
      p_user_id: userId,
      p_allowance: monthlyAllowance,
    });
    if (rpcError) throw new Error(`reset_monthly_credits RPC failed: ${rpcError.message}`);
    console.log(`PayPal: reset monthly credits for user ${userId}:`, rpcResult);
  }
}

/** PAYMENT.SALE.COMPLETED for a subscription renewal (resource.billing_agreement_id set). */
async function handleSubscriptionRenewalSale(resource: Record<string, unknown>): Promise<void> {
  const paypalSubscriptionId = resource.billing_agreement_id as string;

  const subRecord = await resolveSubscriptionRow(paypalSubscriptionId, undefined);
  if (!subRecord) {
    console.warn(`PAYMENT.SALE.COMPLETED: no local record for subscription ${paypalSubscriptionId} — acknowledging without action`);
    return;
  }

  const plan = PLANS[subRecord.plan_slug];
  const monthlyAllowance = plan?.monthlyCredits ?? 0;

  const { data: rpcResult, error: rpcError } = await supabase.rpc('reset_monthly_credits', {
    p_user_id: subRecord.user_id,
    p_allowance: monthlyAllowance,
  });
  if (rpcError) throw new Error(`reset_monthly_credits RPC failed: ${rpcError.message}`);
  console.log(`PayPal: renewal reset monthly credits for user ${subRecord.user_id}:`, rpcResult);
}

async function handleSubscriptionEnded(resource: Record<string, unknown>): Promise<void> {
  const paypalSubscriptionId = resource.id as string;
  const customId = resource.custom_id as string | undefined;

  const subRecord = await resolveSubscriptionRow(paypalSubscriptionId, customId);
  if (!subRecord) {
    console.warn(`subscription ended: no local record for ${paypalSubscriptionId} — acknowledging without action`);
    return;
  }

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'expired', plan_slug: 'free', cancel_at_period_end: false })
    .eq('id', subRecord.id);
  if (updateError) throw new Error(`Failed to expire PayPal subscription record: ${updateError.message}`);

  console.log(`PayPal: expired subscription for user ${subRecord.user_id}, downgraded to free (credits preserved)`);
}

// ─── PAYG order/capture handlers ────────────────────────────────────────────

function parsePaygReferenceId(referenceId: string | undefined): { credits: number; packId: string | null } | null {
  if (!referenceId) return null;
  const [creditsRaw, packId] = referenceId.split(':');
  const credits = parseInt(creditsRaw, 10);
  if (!Number.isFinite(credits) || credits <= 0 || credits > 1_000_000) return null;
  return { credits, packId: packId === 'dynamic' ? null : packId };
}

async function creditPaygPurchase(userId: string, credits: number, captureId: string, packId: string | null): Promise<void> {
  const description = packId
    ? `PAYG credit purchase: ${credits} credits (${packId}, PayPal)`
    : `PAYG credit purchase: ${credits} credits (dynamic, PayPal)`;

  const { error: rpcError } = await supabase.rpc('add_purchased_credits_paypal', {
    p_user_id: userId,
    p_amount: credits,
    p_paypal_capture_id: captureId,
    p_description: description,
  });
  if (rpcError) throw new Error(`add_purchased_credits_paypal RPC failed for user ${userId}: ${rpcError.message}`);

  console.log(`PayPal: added ${credits} credits to user ${userId} (capture ${captureId})`);
}

/**
 * CHECKOUT.ORDER.APPROVED — capture the order server-side as soon as
 * PayPal tells us the buyer approved it, then grant credits immediately.
 * This is the PRIMARY crediting path (more reliable than waiting on the
 * browser to complete the return_url redirect); PAYMENT.CAPTURE.COMPLETED
 * below is a backup, both idempotent on the capture id.
 */
async function handleOrderApproved(creds: PaypalCredentials, resource: Record<string, unknown>): Promise<void> {
  const orderId = resource.id as string;
  const purchaseUnit = (resource.purchase_units as Array<Record<string, unknown>> | undefined)?.[0];
  const userId = purchaseUnit?.custom_id as string | undefined;
  const parsed = parsePaygReferenceId(purchaseUnit?.reference_id as string | undefined);

  if (!userId || !parsed) {
    console.log('CHECKOUT.ORDER.APPROVED: not a recognized PAYG order (missing custom_id/reference_id), skipping');
    return;
  }

  const order = await getOrder(creds, orderId);
  const existingCapture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (existingCapture) {
    // Already captured (e.g. a retried webhook delivery) -- crediting below is idempotent anyway.
    await creditPaygPurchase(userId, parsed.credits, existingCapture.id, parsed.packId);
    return;
  }

  const captured = await captureOrder(creds, orderId);
  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) {
    throw new Error(`CHECKOUT.ORDER.APPROVED: capture call for order ${orderId} returned no capture object`);
  }

  await creditPaygPurchase(userId, parsed.credits, capture.id, parsed.packId);
}

/** PAYMENT.CAPTURE.COMPLETED — backup crediting path; see handleOrderApproved's doc comment. */
async function handleCaptureCompleted(creds: PaypalCredentials, resource: Record<string, unknown>): Promise<void> {
  const captureId = resource.id as string;
  const userId = resource.custom_id as string | undefined;
  const orderId = (resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id;

  if (!userId || !orderId) {
    console.log('PAYMENT.CAPTURE.COMPLETED: missing custom_id/order_id, skipping (handleOrderApproved should already have credited this)');
    return;
  }

  const order = await getOrder(creds, orderId);
  const purchaseUnit = order.purchase_units?.[0];
  const parsed = parsePaygReferenceId(purchaseUnit?.reference_id);
  if (!parsed) {
    console.log('PAYMENT.CAPTURE.COMPLETED: order has no recognized PAYG reference_id, skipping');
    return;
  }

  await creditPaygPurchase(userId, parsed.credits, captureId, parsed.packId);
}

// ─── Event router ───────────────────────────────────────────────────────────

async function routeEvent(creds: PaypalCredentials, event: PaypalWebhookEvent): Promise<boolean> {
  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
      await handleSubscriptionActivated(event.resource);
      return true;
    case 'PAYMENT.SALE.COMPLETED':
      if (!event.resource.billing_agreement_id) {
        console.log('PAYMENT.SALE.COMPLETED: not tied to a subscription (no billing_agreement_id), skipping');
        return false;
      }
      await handleSubscriptionRenewalSale(event.resource);
      return true;
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      await handleSubscriptionEnded(event.resource);
      return true;
    case 'CHECKOUT.ORDER.APPROVED':
      await handleOrderApproved(creds, event.resource);
      return true;
    case 'PAYMENT.CAPTURE.COMPLETED':
      await handleCaptureCompleted(creds, event.resource);
      return true;
    case 'BILLING.SUBSCRIPTION.CREATED':
    case 'BILLING.SUBSCRIPTION.UPDATED':
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      console.log(`PayPal lifecycle event (log-only): ${event.event_type}`);
      return true;
    default:
      console.log(`Unhandled PayPal event type: ${event.event_type} -- returning 200`);
      return false;
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function webhookPaypalRoute(req: Request, res: Response): Promise<void> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error('PAYPAL_WEBHOOK_ID not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const transmissionId = req.headers['paypal-transmission-id'];
  const transmissionTime = req.headers['paypal-transmission-time'];
  const certUrl = req.headers['paypal-cert-url'];
  const authAlgo = req.headers['paypal-auth-algo'];
  const transmissionSig = req.headers['paypal-transmission-sig'];

  if (
    typeof transmissionId !== 'string' ||
    typeof transmissionTime !== 'string' ||
    typeof certUrl !== 'string' ||
    typeof authAlgo !== 'string' ||
    typeof transmissionSig !== 'string'
  ) {
    res.status(400).json({ error: 'Missing PayPal transmission headers' });
    return;
  }

  const rawBodyBuf = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBodyBuf) {
    console.error('webhook-paypal: rawBody not captured -- check express.json({ verify }) in server.ts');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  let event: PaypalWebhookEvent;
  try {
    event = JSON.parse(rawBodyBuf.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  // Verifying the signature itself requires API credentials -- any valid
  // credential set for the account the webhook belongs to works (PayPal's
  // verify-webhook-signature call is not tied to which gateway an admin
  // has marked "active" for checkout).
  const row = await getPaymentGatewaySettingsRow(supabase);
  const resolvedCreds = resolvePaypalCredentials(row);
  if (!resolvedCreds.clientId || !resolvedCreds.clientSecret) {
    console.error('PayPal webhook: no PayPal API credentials configured to verify signature');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }
  const creds: PaypalCredentials = { clientId: resolvedCreds.clientId, clientSecret: resolvedCreds.clientSecret, mode: resolvedCreds.mode };

  let verified: boolean;
  try {
    verified = await verifyPaypalWebhookSignature(
      creds,
      { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig },
      webhookId,
      event,
    );
  } catch (err) {
    console.error('PayPal webhook signature verification call failed:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'Signature verification failed' });
    return;
  }
  if (!verified) {
    console.error('PayPal webhook signature verification failed');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  if (await isEventAlreadyProcessed(event.id)) {
    console.log(`PayPal event ${event.id} already processed, skipping`);
    res.status(200).json({ received: true, status: 'already_processed' });
    return;
  }

  await recordEventStart(event.id, event.event_type, event);

  try {
    const handled = await routeEvent(creds, event);
    await recordEventComplete(event.id);
    res.status(200).json({ received: true, status: handled ? 'processed' : 'ignored', type: event.event_type });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler error';
    console.error(`Error processing PayPal event ${event.event_type} (${event.id}):`, message);
    Sentry.captureException(err, { tags: { webhook: 'paypal', event_type: event.event_type, event_id: event.id } });
    await deadLetter(event, message);
    // Always 200 to PayPal to prevent retry storms -- dead_letter_webhooks handles retries on our side.
    res.status(200).json({ received: true, status: 'error_queued', type: event.event_type });
  }
}
