// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/billing/stripe-portal — create a Stripe Customer Portal session
 * so the user can manage their subscription, payment methods, and
 * invoices in the Stripe-hosted UI.
 *
 * Ported from supabase/functions/stripe-portal (a Supabase Edge Function)
 * — see checkout.ts's file comment for why this self-hosted deployment
 * needs api-v2 routes instead of Edge Functions. Credentials resolved
 * DB-first/env-fallback via gateway-settings.ts (the original read
 * STRIPE_SECRET_KEY only).
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';
import { resolveStripeCredentials, getPaymentGatewaySettingsRow } from '../../../lib/billing/gateway-settings.js';
import { createBillingPortalSession, StripeApiError } from '../../../lib/billing/stripe.js';

interface PortalRequestBody {
  returnUrl?: string;
}

/**
 * Validate the return URL to prevent open-redirect vulnerabilities.
 * Accepts relative paths, HTTPS URLs, and localhost URLs for development.
 */
function validateReturnUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function stripePortalRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }

  const body = (req.body ?? {}) as PortalRequestBody;
  const siteUrl = (process.env.APP_PUBLIC_URL ?? process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const returnUrl = body.returnUrl ?? `${siteUrl}/billing`;

  if (typeof returnUrl !== 'string' || !validateReturnUrl(returnUrl)) {
    res.status(400).json({ error: 'invalid_request', error_description: 'returnUrl must be a valid HTTPS URL or relative path' });
    return;
  }

  try {
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) {
      console.error('Failed to fetch subscription:', subError.message);
      res.status(500).json({ error: 'server_error', error_description: 'Failed to fetch subscription data' });
      return;
    }

    if (!subscription?.stripe_customer_id) {
      res.status(400).json({ error: 'no_subscription', error_description: 'No active subscription found' });
      return;
    }

    const row = await getPaymentGatewaySettingsRow(supabase);
    const { secretKey } = resolveStripeCredentials(row);
    if (!secretKey) {
      res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
      return;
    }

    const session = await createBillingPortalSession(secretKey, {
      customer: subscription.stripe_customer_id,
      return_url: returnUrl,
    });

    res.status(200).json({ portal_url: session.url });
  } catch (err) {
    console.error('Stripe portal session creation failed:', err);
    if (err instanceof StripeApiError) {
      res.status(err.status || 500).json({ error: 'stripe_error', error_description: err.message, stripe_code: err.code });
      return;
    }
    res.status(500).json({
      error: 'stripe_error',
      error_description: err instanceof Error ? err.message : 'Failed to create portal session',
    });
  }
}
