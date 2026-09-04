// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { VariableContextComponent } from '@/components/variable-context';
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
 * Mirrors supabase/functions/_shared/razorpay.ts's getActivePaymentGateway()
 * exactly (same default, same normalization) so the UI's displayed
 * currency/billing-enabled state never disagrees with what checkout
 * actually does. Kept as a plain, non-NEXT_PUBLIC var for the same
 * build-time-inlining reason as SUPABASE_PUBLIC_URL in middleware.ts.
 */
function getActivePaymentGateway(): 'stripe' | 'razorpay' {
  const raw = (process.env.PAYMENT_GATEWAY ?? 'razorpay').trim().toLowerCase();
  return raw === 'stripe' ? 'stripe' : 'razorpay';
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
  gateway: 'stripe' | 'razorpay',
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
  const paymentGateway = getActivePaymentGateway();
  const { currencyCode, currencySymbol, inrToUsdRate } = await getCurrencyDisplay(paymentGateway);
  const billingEnabled =
    paymentGateway === 'razorpay'
      ? Boolean(process.env.RAZORPAY_API_KEY && process.env.RAZORPAY_API_SECRET)
      : Boolean(process.env.STRIPE_SECRET_KEY);

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
