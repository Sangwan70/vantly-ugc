'use client';

// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Runtime configuration for the web app.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at BUILD time, which would bake
 * one deployment's config into the Docker image — a self-hoster could not
 * change it without rebuilding. Instead, the root layout is a server component
 * (`export const dynamic = 'force-dynamic'`) that reads env at REQUEST time and
 * passes the values in here as props.
 *
 * This mirrors the pattern used by our sibling project Postiz
 * (gitroomhq/postiz-app, `libraries/react-shared-libraries/src/helpers/variable.context.tsx`),
 * so one image runs in any environment.
 *
 * Values are exposed to React via `useVariables()` and mirrored onto
 * `window.vars` for the rare non-React reader (`loadVars()`).
 *
 * Only NON-SECRET, browser-safe values belong here. Never pass a service-role
 * key, a provider API key, or any server-only secret into this component.
 */

import { createContext, useContext, useEffect, type FC, type ReactNode } from 'react';

export interface VariableContextInterface {
  /** Public API origin the browser talks to (api-v2). */
  backendUrl: string;
  /** Supabase project URL (browser-safe). */
  supabaseUrl: string;
  /** Supabase anon key — browser-safe by design, protected by RLS. */
  supabaseAnonKey: string;
  /** True when Stripe is configured server-side; hides billing UI when false. */
  billingEnabled: boolean;
  /** Stripe publishable key (browser-safe). Empty when billing is off. */
  stripePublishableKey: string;
  /** Community invite link shown in the dashboard; empty hides the link. */
  discordUrl: string;
  /** Hosted MCP connector URL, shown on the integrations page. */
  mcpUrl: string;
  /** 'development' | 'production' */
  environment: string;
  /** Optional analytics/monitoring DSNs — empty string disables them. */
  sentryDsn: string;
  posthogKey: string;
  /**
   * Comma-separated admin allowlist (NEXT_PUBLIC_ADMIN_EMAILS), for
   * CLIENT-SIDE gating only (e.g. hiding/showing the Admin nav item, the
   * /dashboard/admin page's own auth check) via `isAdminEmailIn()` from
   * lib/admin-allowlist. The real security boundary is server-side
   * (ADMIN_EMAILS, checked in every /api/admin/* route) — this is UX only.
   */
  adminEmails: string;
  /**
   * Which payment gateway checkout/webhooks are actually using (mirrors
   * the Supabase Edge Function secret of the same name — see
   * supabase/functions/_shared/razorpay.ts's getActivePaymentGateway).
   * Drives which currency symbol/amounts the UI displays. Defaults to
   * 'razorpay' when PAYMENT_GATEWAY is unset, same as the Edge Functions.
   */
  paymentGateway: 'stripe' | 'razorpay';
  /** ISO 4217 code for the currency prices are displayed in: 'INR' when paymentGateway is 'razorpay', else 'USD'. */
  currencyCode: string;
  /** Symbol for currencyCode ('₹' or '$'). */
  currencySymbol: string;
  /**
   * INR-per-USD rate used to convert the app's USD-cent-denominated base
   * prices into an estimated INR display amount, read from the `currencies`
   * table's INR row (Settings -> Currency) at request time. `null` when
   * paymentGateway is 'stripe' (no conversion needed). This is a DISPLAY
   * ESTIMATE only — the amount RazorPay actually charges for a subscription
   * tier is whatever the RazorPay Plan (RAZORPAY_PLAN_STARTER etc.) was
   * created with, which this rate does not control and can drift from if
   * not kept in sync. PAYG top-ups don't have this drift risk: checkout
   * computes the real charged paise amount from this SAME rate at request time.
   */
  inrToUsdRate: number | null;
}

const EMPTY: VariableContextInterface = {
  backendUrl: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  billingEnabled: false,
  stripePublishableKey: '',
  discordUrl: '',
  mcpUrl: '',
  environment: 'production',
  sentryDsn: '',
  posthogKey: '',
  adminEmails: '',
  paymentGateway: 'razorpay',
  currencyCode: 'INR',
  currencySymbol: '₹',
  inrToUsdRate: null,
};

const VariableContext = createContext<VariableContextInterface>(EMPTY);

export const VariableContextComponent: FC<
  VariableContextInterface & { children: ReactNode }
> = (props) => {
  const { children, ...vars } = props;

  // Publish synchronously during render, not in an effect. Module-level code in
  // client bundles (e.g. `const SUPABASE_URL = getVar('supabaseUrl')`) runs at
  // import time, which is BEFORE effects flush — an effect-only assignment
  // would hand those modules an empty string on first paint.
  if (typeof window !== 'undefined') {
    (window as unknown as { vars: VariableContextInterface }).vars = vars;
  }

  // Keep it in sync if props change on a later render.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { vars: VariableContextInterface }).vars = vars;
    }
  }, [vars]);

  return <VariableContext.Provider value={vars}>{children}</VariableContext.Provider>;
};

/** Read runtime config inside a React component. */
export const useVariables = () => useContext(VariableContext);

/**
 * Read one runtime value outside React, with a build-time fallback.
 *
 * Call this LAZILY (inside a function or handler), never at module top level:
 * imported modules evaluate before the root layout renders, so a module-level
 * `const X = getVar('supabaseUrl')` would capture an empty string forever.
 * Write `const supabaseUrl = () => getVar('supabaseUrl')` instead.
 */
export function getVar<K extends keyof VariableContextInterface>(
  key: K,
  fallback?: VariableContextInterface[K],
): VariableContextInterface[K] {
  const v = loadVars()[key];
  return (v === '' || v === undefined ? (fallback ?? v) : v) as VariableContextInterface[K];
}

/** Read runtime config outside React (after first client render). */
export const loadVars = (): VariableContextInterface =>
  (typeof window !== 'undefined'
    ? (window as unknown as { vars?: VariableContextInterface }).vars
    : undefined) ?? EMPTY;
