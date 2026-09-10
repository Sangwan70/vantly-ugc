// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { VariableContextComponent } from '@/components/variable-context';
import {
  getPaymentGatewaySettingsRow,
  resolveActiveGateway,
  resolveStripeCredentials,
  resolveRazorpayCredentials,
  resolvePaypalCredentials,
  type GatewayId,
  type PaymentGatewaySettingsRow,
} from '@/lib/billing/gateway-settings';
import './globals.css';

/**
 * Rendered per-request, not at build time.
 *
 * This is what lets ONE Docker image serve any environment: `process.env` is
 * read below on each request and handed to VariableContextComponent as props,
 * instead of Next.js inlining `NEXT_PUBLIC_*` values into the bundle at build
 * time. Same approach as our sibling project Postiz.
 */
export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'Vantly UGC',
  description: 'Agent-native AI UGC video generation.',
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

/**
 * DB-first, env-fallback gateway resolution -- mirrors
 * services/api-v2/src/lib/billing/gateway-settings.ts's resolveActiveGateway
 * (same table, same precedence) so the UI's displayed gateway/currency/
 * billing-enabled state never disagrees with what live checkout actually
 * uses. Originally this only read the PAYMENT_GATEWAY env var (matching the
 * old, now-unreachable Supabase Edge Functions' own getActivePaymentGateway)
 * -- that env-only path is kept as getActivePaymentGatewayFromEnv() below,
 * used as a fallback if the payment_gateway_settings table can't be read
 * (e.g. its migration hasn't been applied yet), same defensive pattern as
 * getCurrencyDisplay's own try/catch below.
 */
function getActivePaymentGatewayFromEnv(): GatewayId {
  const raw = (process.env.PAYMENT_GATEWAY ?? 'razorpay').trim().toLowerCase();
  return raw === 'stripe' ? 'stripe' : 'razorpay';
}

/**
 * Cached the same way as the INR rate below (this layout wraps the whole
 * app, so re-querying on every request would add a DB round-trip to every
 * page load; the admin rarely changes this, and this container is
 * long-running so a module-level cache persists usefully across requests).
 */
const GATEWAY_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
let gatewaySettingsCache: { row: PaymentGatewaySettingsRow; fetchedAt: number } | null = null;

async function getPaymentGatewaySettingsRowCached(): Promise<PaymentGatewaySettingsRow | null> {
  if (gatewaySettingsCache && Date.now() - gatewaySettingsCache.fetchedAt < GATEWAY_SETTINGS_CACHE_TTL_MS) {
    return gatewaySettingsCache.row;
  }
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');
    const admin = createAdminClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const row = await getPaymentGatewaySettingsRow(admin);
    gatewaySettingsCache = { row, fetchedAt: Date.now() };
    return row;
  } catch (err) {
    console.error('Failed to load payment_gateway_settings, falling back to PAYMENT_GATEWAY env var:', err);
    return null;
  }
}

/** Whether the resolved gateway is actually configured with usable credentials (DB-first, env-fallback), mirroring resolveActiveGatewayAndCredentials's per-gateway checks on the api-v2 side. */
function resolveBillingEnabled(gateway: GatewayId, row: PaymentGatewaySettingsRow | null): boolean {
  if (gateway === 'razorpay') {
    if (row) {
      const creds = resolveRazorpayCredentials(row);
      return Boolean(creds.keyId && creds.keySecret);
    }
    return Boolean(process.env.RAZORPAY_API_KEY && process.env.RAZORPAY_API_SECRET);
  }
  if (gateway === 'paypal') {
    if (row) {
      const creds = resolvePaypalCredentials(row);
      return Boolean(creds.clientId && creds.clientSecret);
    }
    return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  }
  if (row) return Boolean(resolveStripeCredentials(row).secretKey);
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Kept in sync with supabase/migrations/20260904140000_razorpay_billing.sql's
 * INR seed row AND supabase/functions/_shared/currency.ts's fallback
 * reasoning — used only if the DB read below fails, so the UI never has no
 * rate at all (mirrors AutoGPT platform's own FALLBACK_USD_TO_INR_RATE).
 */
const FALLBACK_INR_TO_USD_RATE = 89;

/** Re-fetching the INR rate on every single page load (this layout wraps
 * the whole app) would add a DB round-trip to every request. The rate
 * changes rarely (an admin edits it in Settings -> Currency), so it's
 * cached in-process for a few minutes instead — this container is
 * long-running (docker-compose service), not a fresh process per request,
 * so a module-level cache actually persists usefully between requests. */
const INR_RATE_CACHE_TTL_MS = 5 * 60 * 1000;
let inrRateCache: { symbol: string; rate: number; fetchedAt: number } | null = null;

async function getCurrencyDisplay(
  gateway: GatewayId,
): Promise<{ currencyCode: string; currencySymbol: string; inrToUsdRate: number | null }> {
  if (gateway !== 'razorpay') {
    return { currencyCode: 'USD', currencySymbol: '$', inrToUsdRate: null };
  }

  if (inrRateCache && Date.now() - inrRateCache.fetchedAt < INR_RATE_CACHE_TTL_MS) {
    return { currencyCode: 'INR', currencySymbol: inrRateCache.symbol, inrToUsdRate: inrRateCache.rate };
  }

  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');

    const admin = createAdminClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await admin
      .from('currencies')
      .select('symbol, exchange_rate_to_usd, is_active')
      .eq('code', 'INR')
      .maybeSingle();
    if (error) throw new Error(error.message);

    // If INR isn't active yet in Settings -> Currency, the checkout edge
    // function (see supabase/functions/_shared/currency.ts's
    // getInrToUsdRate) will refuse to charge in INR at all -- fall back to
    // the same FALLBACK_INR_TO_USD_RATE used on a query error below rather
    // than displaying a configured-but-not-yet-live rate as if it were
    // authoritative. This keeps what's shown here from ever promising a
    // price that PAYG checkout isn't actually ready to charge.
    const parsedRate = data?.exchange_rate_to_usd ? Number(data.exchange_rate_to_usd) : NaN;
    const rate =
      data?.is_active && Number.isFinite(parsedRate) && parsedRate > 0
        ? parsedRate
        : FALLBACK_INR_TO_USD_RATE;
    const symbol = data?.symbol || '₹';

    inrRateCache = { symbol, rate, fetchedAt: Date.now() };
    return { currencyCode: 'INR', currencySymbol: symbol, inrToUsdRate: rate };
  } catch (err) {
    console.error('Failed to load INR currency display config, using fallback rate:', err);
    return { currencyCode: 'INR', currencySymbol: '₹', inrToUsdRate: FALLBACK_INR_TO_USD_RATE };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const gatewaySettingsRow = await getPaymentGatewaySettingsRowCached();
  const paymentGateway: GatewayId = gatewaySettingsRow
    ? resolveActiveGateway(gatewaySettingsRow)
    : getActivePaymentGatewayFromEnv();
  const { currencyCode, currencySymbol, inrToUsdRate } = await getCurrencyDisplay(paymentGateway);
  const billingEnabled = resolveBillingEnabled(paymentGateway, gatewaySettingsRow);

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/*
          Guard against the Google-Translate x React crash. Chrome's built-in
          auto-translate wraps text in <font> nodes and relocates them; React's
          reconciler then calls insertBefore/removeChild against nodes that are
          no longer children -> DOMException code 8 (NotFoundError) that white-
          screens the page for translated users. We make those two ops a no-op
          ONLY in that impossible case - correct DOM operations are untouched,
          and translation keeps working. Must run before hydration, hence a raw
          inline script.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){if(typeof Node!=='function'||!Node.prototype)return;var ib=Node.prototype.insertBefore;Node.prototype.insertBefore=function(n,r){if(r&&r.parentNode!==this)return n;return ib.apply(this,arguments)};var rc=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this)return c;return rc.apply(this,arguments)}})();",
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-text antialiased">
        <VariableContextComponent
          backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL ?? process.env.API_V2_URL ?? ''}
          appPublicUrl={process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '') ?? ''}
          supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}
          supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}
          billingEnabled={billingEnabled}
          stripePublishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
          discordUrl={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? ''}
          mcpUrl={process.env.NEXT_PUBLIC_MCP_URL ?? ''}
          environment={process.env.NODE_ENV ?? 'production'}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''}
          posthogKey={process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''}
          adminEmails={process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? ''}
          paymentGateway={paymentGateway}
          currencyCode={currencyCode}
          currencySymbol={currencySymbol}
          inrToUsdRate={inrToUsdRate}
        >
          {children}
        </VariableContextComponent>
      </body>
    </html>
  );
}
