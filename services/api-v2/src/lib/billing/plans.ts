// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Canonical plan-tier metadata for live checkout/webhook processing in
 * api-v2, ported from supabase/functions/_shared/plans.ts and
 * supabase/functions/webhook-stripe/plans.ts (a Supabase Edge Function --
 * see routes/v1/billing/checkout.ts's file comment for why this exists as
 * a plain route/lib instead: this self-hosted stack's gateway doesn't run
 * an Edge Functions runtime at all).
 *
 * Kept in sync by hand with the Deno originals -- if the plan/credit
 * definitions ever change, update both.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PlanDefinition {
  readonly slug: string;
  readonly monthlyCredits: number;
  readonly maxResolution: string;
  readonly hasWatermark: boolean;
  readonly hasPriority: boolean;
  readonly hasApiAccess: boolean;
  readonly maxConcurrentJobs: number;
}

export interface PaygPackDefinition {
  readonly packId: string;
  readonly credits: number;
  readonly priceUsd: number;
}

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    slug: 'free', monthlyCredits: 0, maxResolution: '720p',
    hasWatermark: true, hasPriority: false, hasApiAccess: false, maxConcurrentJobs: 1,
  },
  newby: {
    slug: 'newby', monthlyCredits: 1300, maxResolution: '1080p',
    hasWatermark: false, hasPriority: false, hasApiAccess: false, maxConcurrentJobs: 2,
  },
  starter: {
    slug: 'starter', monthlyCredits: 3900, maxResolution: '1080p',
    hasWatermark: false, hasPriority: false, hasApiAccess: false, maxConcurrentJobs: 3,
  },
  creator: {
    slug: 'creator', monthlyCredits: 6900, maxResolution: '2k',
    hasWatermark: false, hasPriority: true, hasApiAccess: false, maxConcurrentJobs: 5,
  },
  pro_plus: {
    slug: 'pro_plus', monthlyCredits: 12900, maxResolution: '2k',
    hasWatermark: false, hasPriority: true, hasApiAccess: true, maxConcurrentJobs: 10,
  },
};

export const PAID_PLAN_SLUGS = ['starter', 'creator', 'pro_plus'] as const;
export type PaidPlanSlug = (typeof PAID_PLAN_SLUGS)[number];

export function isPaidPlanSlug(slug: string): slug is PaidPlanSlug {
  return (PAID_PLAN_SLUGS as readonly string[]).includes(slug);
}

export const PAYG_PACKS: Record<string, PaygPackDefinition> = {
  pack_3900: { packId: 'pack_3900', credits: 3900, priceUsd: 39 },
};

/**
 * Legacy env-var-based Stripe price / RazorPay plan id resolution --
 * STRIPE_PRICE_STARTER etc. Kept as a FALLBACK only: checkout.ts prefers
 * the `plans` table's stripe_price_id/razorpay_plan_id columns (populated
 * via Settings -> Payment Gateways' "Sync all plans", the same mechanism
 * apps/web/lib/billing/plan-gateway-sync.ts uses for admin plan minting),
 * since that's now the source of truth an admin actually edits. A
 * deployment that hasn't touched the new Payment Gateways tab yet still
 * works unchanged via these env vars.
 */
const STRIPE_PRICE_ENV_VARS: Record<string, string> = {
  newby: 'STRIPE_PRICE_NEWBY',
  starter: 'STRIPE_PRICE_STARTER',
  creator: 'STRIPE_PRICE_CREATOR',
  pro_plus: 'STRIPE_PRICE_PRO_PLUS',
};

export function getStripePriceIdFromEnv(slug: string): string | undefined {
  const envVar = STRIPE_PRICE_ENV_VARS[slug];
  return envVar ? process.env[envVar] || undefined : undefined;
}

let _priceIdMap: Map<string, PlanDefinition> | null = null;
function buildPriceIdMap(): Map<string, PlanDefinition> {
  const map = new Map<string, PlanDefinition>();
  for (const slug of Object.keys(STRIPE_PRICE_ENV_VARS)) {
    const priceId = getStripePriceIdFromEnv(slug);
    const plan = PLANS[slug];
    if (priceId && plan) map.set(priceId, plan);
  }
  return map;
}
/** Resolve a Stripe price id (from env-var config) back to a plan definition. */
export function planByPriceIdFromEnv(priceId: string): PlanDefinition | undefined {
  if (!_priceIdMap) _priceIdMap = buildPriceIdMap();
  return _priceIdMap.get(priceId);
}

const RAZORPAY_PLAN_ENV_VARS: Record<PaidPlanSlug, string> = {
  starter: 'RAZORPAY_PLAN_STARTER',
  creator: 'RAZORPAY_PLAN_CREATOR',
  pro_plus: 'RAZORPAY_PLAN_PRO_PLUS',
};
export function getRazorpayPlanIdFromEnv(slug: string): string | undefined {
  if (!isPaidPlanSlug(slug)) return undefined;
  return process.env[RAZORPAY_PLAN_ENV_VARS[slug]] || undefined;
}

let _razorpayPlanIdMap: Map<string, PlanDefinition> | null = null;
function buildRazorpayPlanIdMap(): Map<string, PlanDefinition> {
  const map = new Map<string, PlanDefinition>();
  for (const slug of PAID_PLAN_SLUGS) {
    const planId = getRazorpayPlanIdFromEnv(slug);
    const plan = PLANS[slug];
    if (planId && plan) map.set(planId, plan);
  }
  return map;
}
/** Resolve a RazorPay Plan id (from env-var config) back to a plan definition. */
export function planByRazorpayPlanIdFromEnv(planId: string): PlanDefinition | undefined {
  if (!_razorpayPlanIdMap) _razorpayPlanIdMap = buildRazorpayPlanIdMap();
  return _razorpayPlanIdMap.get(planId);
}

// ── DB-first price/plan id resolution ───────────────────────────────────────
//
// The `plans` table (supabase/migrations/20260904160000_plans_table.sql) is
// the source of truth an admin actually edits (Settings -> Payment Gateways
// -> "Sync all plans", via apps/web/lib/billing/plan-gateway-sync.ts). These
// helpers prefer it, falling back to the legacy env vars above only when a
// deployment hasn't populated/synced that table yet -- so an existing
// production deployment that has never touched the new admin tab keeps
// working unchanged.

interface PlanRow {
  slug: string;
  stripe_price_id: string | null;
  razorpay_plan_id: string | null;
}

/** Resolve a paid tier's Stripe price id: `plans` table first, env fallback. */
export async function resolveStripePriceId(db: SupabaseClient, slug: string): Promise<string | undefined> {
  const { data } = await db
    .from('plans')
    .select('stripe_price_id')
    .eq('slug', slug)
    .maybeSingle();
  const dbValue = (data as { stripe_price_id: string | null } | null)?.stripe_price_id;
  return dbValue?.trim() || getStripePriceIdFromEnv(slug);
}

/** Resolve a paid tier's RazorPay plan id: `plans` table first, env fallback. */
export async function resolveRazorpayPlanId(db: SupabaseClient, slug: string): Promise<string | undefined> {
  const { data } = await db
    .from('plans')
    .select('razorpay_plan_id')
    .eq('slug', slug)
    .maybeSingle();
  const dbValue = (data as { razorpay_plan_id: string | null } | null)?.razorpay_plan_id;
  return dbValue?.trim() || getRazorpayPlanIdFromEnv(slug);
}

/**
 * Resolve a Stripe price id back to a plan definition: `plans` table first
 * (any row, not just paid tiers named in the env map above), env fallback.
 */
export async function resolvePlanByStripePriceId(
  db: SupabaseClient,
  priceId: string,
): Promise<PlanDefinition | undefined> {
  const { data } = await db.from('plans').select('slug, stripe_price_id, razorpay_plan_id').eq('stripe_price_id', priceId).maybeSingle();
  const row = data as PlanRow | null;
  if (row && PLANS[row.slug]) return PLANS[row.slug];
  return planByPriceIdFromEnv(priceId);
}

/** Resolve a RazorPay plan id back to a plan definition: `plans` table first, env fallback. */
export async function resolvePlanByRazorpayPlanId(
  db: SupabaseClient,
  planId: string,
): Promise<PlanDefinition | undefined> {
  const { data } = await db.from('plans').select('slug, stripe_price_id, razorpay_plan_id').eq('razorpay_plan_id', planId).maybeSingle();
  const row = data as PlanRow | null;
  if (row && PLANS[row.slug]) return PLANS[row.slug];
  return planByRazorpayPlanIdFromEnv(planId);
}

/**
 * Resolve a paid tier's PayPal plan id: `plans` table only -- no legacy env
 * var convention exists for PayPal (it was never wired into live checkout
 * before this), so there is nothing to fall back to. An admin mints this
 * via Settings -> Payment Gateways' "Sync all plans"
 * (apps/web/lib/billing/plan-gateway-sync.ts's mintMissingGatewayIds,
 * which calls apps/web/lib/billing/gateway-admin.ts's createPaypalPlan).
 */
export async function resolvePaypalPlanId(db: SupabaseClient, slug: string): Promise<string | undefined> {
  const { data } = await db
    .from('plans')
    .select('paypal_plan_id')
    .eq('slug', slug)
    .maybeSingle();
  const dbValue = (data as { paypal_plan_id: string | null } | null)?.paypal_plan_id;
  return dbValue?.trim() || undefined;
}

interface PlanRowWithPaypal extends PlanRow {
  paypal_plan_id: string | null;
}

/** Resolve a PayPal plan id back to a plan definition: `plans` table only (see resolvePaypalPlanId). */
export async function resolvePlanByPaypalPlanId(
  db: SupabaseClient,
  planId: string,
): Promise<PlanDefinition | undefined> {
  const { data } = await db
    .from('plans')
    .select('slug, stripe_price_id, razorpay_plan_id, paypal_plan_id')
    .eq('paypal_plan_id', planId)
    .maybeSingle();
  const row = data as PlanRowWithPaypal | null;
  if (row && PLANS[row.slug]) return PLANS[row.slug];
  return undefined;
}

// ─── Calendar-month arithmetic (for trial_months coupons) ──────────────────

/**
 * Add `months` calendar months (UTC) to a unix-seconds timestamp, returning
 * a unix-seconds timestamp. Used by both the RazorPay (`start_at`) and
 * Stripe (`subscription_data.trial_end`) checkout paths for trial_months
 * coupons, so "N months free" lands on the same calendar date regardless
 * of gateway -- deliberately NOT `months * 30 * 86400` (drifts from actual
 * calendar months, and two independent day-math implementations could
 * silently disagree with each other).
 *
 * Month-end clamping follows native JS `Date` UTC semantics: if the target
 * month is shorter than the source day-of-month, it rolls into the next
 * month (e.g. Jan 31 + 1 month -> Mar 3, not Feb 28) -- same behavior
 * `Date.UTC` gives for any out-of-range day component. Trial coupons are
 * expected to be redeemed against the current date, so this edge case is
 * rare (only touches trials redeemed on the 29th-31st of a month) but is
 * documented here rather than silently relied upon.
 */
export function addCalendarMonthsUTC(fromUnixSeconds: number, months: number): number {
  const d = new Date(fromUnixSeconds * 1000);
  const result = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  ));
  return Math.floor(result.getTime() / 1000);
}
