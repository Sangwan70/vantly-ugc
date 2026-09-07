// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /v1/billing/billing-history — the authenticated user's invoices
 * (subscription + PAYG) and default payment method.
 *
 * Ported from supabase/functions/billing-history (a Supabase Edge
 * Function) — see checkout.ts's file comment for why this self-hosted
 * deployment needs api-v2 routes instead of Edge Functions. Credentials
 * resolved DB-first/env-fallback via gateway-settings.ts.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';
import { resolveStripeCredentials, resolveRazorpayCredentials, resolvePaypalCredentials, getPaymentGatewaySettingsRow } from '../../../lib/billing/gateway-settings.js';
import { listInvoices, retrieveCustomer } from '../../../lib/billing/stripe.js';
import { listSubscriptionInvoices } from '../../../lib/billing/razorpay.js';
import { listSubscriptionTransactions } from '../../../lib/billing/paypal.js';

interface CreditTxRow {
  amount: number;
  description: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  type: string;
}

interface InvoiceRow {
  date: string;
  amount_paid: number;
  currency: string;
  status: string;
  invoice_url: string | null;
  description: string;
  credits: number | null;
}

export async function billingHistoryRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }

  try {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('payment_gateway, stripe_customer_id, razorpay_subscription_id, paypal_subscription_id')
      .eq('user_id', userId)
      .or('stripe_customer_id.not.is.null,razorpay_subscription_id.not.is.null,paypal_subscription_id.not.is.null')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription?.stripe_customer_id && !subscription?.razorpay_subscription_id && !subscription?.paypal_subscription_id) {
      res.status(200).json({ invoices: [], payment_method: null });
      return;
    }

    const isRazorpay = subscription.payment_gateway === 'razorpay';
    const isPaypal = subscription.payment_gateway === 'paypal';

    const paygQueryPromise = supabase
      .from('credit_transactions')
      .select('amount, description, created_at, metadata, type')
      .eq('user_id', userId)
      .in('type', ['purchase_credit', 'auto_topup_credit'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (isPaypal) {
      const row = await getPaymentGatewaySettingsRow(supabase);
      const creds = resolvePaypalCredentials(row);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 365 * 24 * 60 * 60 * 1000);

      const [paypalTransactions, paygResult] = await Promise.all([
        subscription.paypal_subscription_id && creds.clientId && creds.clientSecret
          ? listSubscriptionTransactions(
              { clientId: creds.clientId, clientSecret: creds.clientSecret, mode: creds.mode },
              subscription.paypal_subscription_id,
              startTime.toISOString(),
              endTime.toISOString(),
            ).catch((err) => {
              console.error('Failed to list PayPal transactions:', err);
              return [];
            })
          : Promise.resolve([]),
        paygQueryPromise,
      ]);

      const subscriptionInvoices: InvoiceRow[] = paypalTransactions.map((tx) => ({
        date: tx.time,
        amount_paid: Number(tx.amount_with_breakdown?.gross_amount?.value ?? 0),
        currency: (tx.amount_with_breakdown?.gross_amount?.currency_code ?? 'usd').toLowerCase(),
        status: (tx.status ?? 'unknown').toLowerCase(),
        invoice_url: null,
        description: 'Subscription',
        credits: null,
      }));

      const paygInvoices: InvoiceRow[] = ((paygResult.data ?? []) as CreditTxRow[]).map((tx) => {
        const isAuto = tx.type === 'auto_topup_credit';
        return {
          date: tx.created_at,
          amount_paid: tx.amount / 100,
          currency: 'usd',
          status: 'paid',
          invoice_url: null,
          description: tx.description ?? `${isAuto ? 'Auto-recharge' : 'Credit purchase'}: +${tx.amount.toLocaleString()} credits`,
          credits: tx.amount,
        };
      });

      const invoices = [...subscriptionInvoices, ...paygInvoices].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      // PayPal has no direct equivalent of Stripe's saved default payment
      // method surfaced via the Customer object -- out of scope for this
      // pass, same as RazorPay above.
      res.status(200).json({ invoices, payment_method: null });
      return;
    }

    if (isRazorpay) {
      const row = await getPaymentGatewaySettingsRow(supabase);
      const creds = resolveRazorpayCredentials(row);

      const [razorpayInvoices, paygResult] = await Promise.all([
        subscription.razorpay_subscription_id && creds.keyId && creds.keySecret
          ? listSubscriptionInvoices(
              { keyId: creds.keyId, keySecret: creds.keySecret },
              subscription.razorpay_subscription_id,
              20,
            ).catch((err) => {
              console.error('Failed to list RazorPay invoices:', err);
              return [];
            })
          : Promise.resolve([]),
        paygQueryPromise,
      ]);

      const subscriptionInvoices: InvoiceRow[] = razorpayInvoices.map((inv) => ({
        date: new Date(inv.date * 1000).toISOString(),
        amount_paid: (inv.amount_paid ?? 0) / 100,
        currency: (inv.currency ?? 'inr').toLowerCase(),
        status: inv.status ?? 'unknown',
        invoice_url: inv.short_url ?? null,
        description: inv.description ?? 'Subscription',
        credits: null,
      }));

      const paygInvoices: InvoiceRow[] = ((paygResult.data ?? []) as CreditTxRow[]).map((tx) => {
        const isAuto = tx.type === 'auto_topup_credit';
        return {
          date: tx.created_at,
          amount_paid: tx.amount / 100,
          currency: 'usd',
          status: 'paid',
          invoice_url: null,
          description: tx.description ?? `${isAuto ? 'Auto-recharge' : 'Credit purchase'}: +${tx.amount.toLocaleString()} credits`,
          credits: tx.amount,
        };
      });

      const invoices = [...subscriptionInvoices, ...paygInvoices].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      res.status(200).json({ invoices, payment_method: null });
      return;
    }

    const row = await getPaymentGatewaySettingsRow(supabase);
    const { secretKey } = resolveStripeCredentials(row);
    if (!secretKey) {
      res.status(500).json({ error: 'configuration_error', error_description: 'Payment system is not configured' });
      return;
    }

    const customerId = subscription.stripe_customer_id as string;

    const [invoicesResult, customerResult, paygResult] = await Promise.all([
      listInvoices(secretKey, { customer: customerId, limit: 20 }),
      retrieveCustomer(secretKey, customerId, { expand: ['invoice_settings.default_payment_method'] }),
      paygQueryPromise,
    ]);

    const subscriptionInvoices: InvoiceRow[] = invoicesResult.data.map((inv) => ({
      date: new Date(inv.created * 1000).toISOString(),
      amount_paid: (inv.amount_paid ?? 0) / 100,
      currency: inv.currency ?? 'usd',
      status: inv.status ?? 'unknown',
      invoice_url: inv.hosted_invoice_url ?? null,
      description: inv.description ?? inv.lines?.data?.[0]?.description ?? 'Subscription',
      credits: null,
    }));

    const paygInvoices: InvoiceRow[] = ((paygResult.data ?? []) as CreditTxRow[]).map((tx) => {
      const isAuto = tx.type === 'auto_topup_credit';
      const amountCents = Number((tx.metadata as Record<string, unknown> | null)?.amount_cents ?? 0);
      return {
        date: tx.created_at,
        amount_paid: amountCents > 0 ? amountCents / 100 : tx.amount / 100,
        currency: 'usd',
        status: 'paid',
        invoice_url: null,
        description: tx.description ?? `${isAuto ? 'Auto-recharge' : 'Credit purchase'}: +${tx.amount.toLocaleString()} credits`,
        credits: tx.amount,
      };
    });

    const invoices = [...subscriptionInvoices, ...paygInvoices].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    let paymentMethod: { brand: string; last4: string; exp_month: number; exp_year: number } | null = null;
    if (!customerResult.deleted) {
      const pm = customerResult.invoice_settings?.default_payment_method;
      if (pm && typeof pm === 'object' && 'card' in (pm as Record<string, unknown>) && (pm as Record<string, unknown>).card) {
        const card = (pm as Record<string, unknown>).card as { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
        paymentMethod = {
          brand: card.brand ?? 'unknown',
          last4: card.last4 ?? '****',
          exp_month: card.exp_month ?? 0,
          exp_year: card.exp_year ?? 0,
        };
      }
    }

    res.status(200).json({ invoices, payment_method: paymentMethod });
  } catch (err) {
    console.error('Unhandled error in billing-history:', err);
    res.status(500).json({ error: 'server_error', error_description: err instanceof Error ? err.message : 'Internal server error' });
  }
}
