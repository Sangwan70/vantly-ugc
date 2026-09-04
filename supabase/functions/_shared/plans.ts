// Copyright 2026 Vantly UGC contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical plan-tier metadata, shared across every billing Edge Function
 * (checkout, webhook-stripe, webhook-razorpay, cancel-subscription,
 * billing-history).
 *
 * This was previously defined only inside webhook-stripe/plans.ts, with
 * checkout/index.ts keeping its own separate (Stripe-price-only) copy --
 * moved here so a plan's credit allowance / feature set has exactly one
 * definition regardless of which gateway is active. webhook-stripe/plans.ts
 * re-exports PLANS/PAYG_PACKS from here unchanged; its Stripe-price-id
 * resolution (planByPriceId) stays there since it's Stripe-specific.
 *
 * Pricing reference (architecture doc Section 2.2):
 *   Free       $0/mo   — 50 one-time credits, 720p, watermark, no PAYG
 *   Creator   $39/mo   — 3,900 credits/mo, 1080p, no watermark (~13 10s videos)
 *   Pro       $69/mo   — 6,900 credits/mo, 2K, priority queue (~23 10s videos)
 *   Pro Plus $129/mo   — 12,900 credits/mo, 2K, API access (~43 10s videos)
 *   Enterprise  custom  — unlimited, dedicated support
 *
 *   Newby ($19) is deprecated — kept in code to honour legacy subscribers,
 *   but no longer shown on the pricing page or offered to new users.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlanDefinition {
  /** Slug stored in subscriptions.plan_slug */
  readonly slug: string;
  /** Monthly credit allowance (0 for free — one-time allocation handled separately) */
  readonly monthlyCredits: number;
  /** Maximum video resolution tier */
  readonly maxResolution: string;
  /** Whether generated media has a watermark */
  readonly hasWatermark: boolean;
  /** Whether the user gets priority queue placement */
  readonly hasPriority: boolean;
  /** Whether API key access is enabled (Pro+) */
  readonly hasApiAccess: boolean;
  /** Maximum concurrent generation jobs */
  readonly maxConcurrentJobs: number;
}

export interface PaygPackDefinition {
  /** Unique pack identifier stored in payment intent metadata */
  readonly packId: string;
  /** Number of credits included in the pack */
  readonly credits: number;
  /** Price in USD (used for display / reconciliation) */
  readonly priceUsd: number;
}

// ─── Plan Definitions ───────────────────────────────────────────────────────

/** Map of plan slug -> plan definition. */
export const PLANS: Record<string, PlanDefinition> = {
  free: {
    slug: "free",
    monthlyCredits: 0,
    maxResolution: "720p",
    hasWatermark: true,
    hasPriority: false,
    hasApiAccess: false,
    maxConcurrentJobs: 1,
  },
  newby: {
    slug: "newby",
    monthlyCredits: 1300,
    maxResolution: "1080p",
    hasWatermark: false,
    hasPriority: false,
    hasApiAccess: false,
    maxConcurrentJobs: 2,
  },
  starter: {
    slug: "starter",
    monthlyCredits: 3900,
    maxResolution: "1080p",
    hasWatermark: false,
    hasPriority: false,
    hasApiAccess: false,
    maxConcurrentJobs: 3,
  },
  creator: {
    slug: "creator",
    monthlyCredits: 6900,
    maxResolution: "2k",
    hasWatermark: false,
    hasPriority: true,
    hasApiAccess: false,
    maxConcurrentJobs: 5,
  },
  pro_plus: {
    slug: "pro_plus",
    monthlyCredits: 12900,
    maxResolution: "2k",
    hasWatermark: false,
    hasPriority: true,
    hasApiAccess: true,
    maxConcurrentJobs: 10,
  },
};

/** Tiers a user can actually subscribe to today (excludes free/newby). */
export const PAID_PLAN_SLUGS = ["starter", "creator", "pro_plus"] as const;
export type PaidPlanSlug = (typeof PAID_PLAN_SLUGS)[number];

export function isPaidPlanSlug(slug: string): slug is PaidPlanSlug {
  return (PAID_PLAN_SLUGS as readonly string[]).includes(slug);
}

// ─── PAYG Credit Packs ──────────────────────────────────────────────────────

/**
 * Available pay-as-you-go credit packs.
 *
 * pack_id is placed in the gateway's payment metadata/notes so the webhook
 * can resolve the correct credit amount without trusting the client.
 */
export const PAYG_PACKS: Record<string, PaygPackDefinition> = {
  pack_3900: {
    packId: "pack_3900",
    credits: 3900,
    priceUsd: 39,
  },
};

// ─── RazorPay Plan ID resolution ────────────────────────────────────────────

/**
 * RazorPay Plan IDs (plan_xxx) are created per tier in the RazorPay
 * dashboard/API ahead of time (RazorPay has no "price" object like Stripe —
 * a Plan bundles amount+interval+currency together), then wired in here via
 * env var. Naming mirrors STRIPE_PRICE_* in checkout/index.ts and
 * webhook-stripe/plans.ts.
 */
const RAZORPAY_PLAN_ENV_VARS: Record<PaidPlanSlug, string> = {
  starter: "RAZORPAY_PLAN_STARTER",
  creator: "RAZORPAY_PLAN_CREATOR",
  pro_plus: "RAZORPAY_PLAN_PRO_PLUS",
};

/** Resolve a paid tier's RazorPay Plan ID from its env var. */
export function getRazorpayPlanId(slug: string): string | undefined {
  if (!isPaidPlanSlug(slug)) return undefined;
  const envVar = RAZORPAY_PLAN_ENV_VARS[slug];
  return Deno.env.get(envVar) || undefined;
}

let _razorpayPlanIdMap: Map<string, PlanDefinition> | null = null;

function buildRazorpayPlanIdMap(): Map<string, PlanDefinition> {
  const map = new Map<string, PlanDefinition>();
  for (const slug of PAID_PLAN_SLUGS) {
    const planId = getRazorpayPlanId(slug);
    if (planId) map.set(planId, PLANS[slug]);
  }
  return map;
}

/** Resolve a RazorPay Plan ID (plan_xxx) back to a plan definition. */
export function planByRazorpayPlanId(planId: string): PlanDefinition | undefined {
  if (!_razorpayPlanIdMap) {
    _razorpayPlanIdMap = buildRazorpayPlanIdMap();
  }
  return _razorpayPlanIdMap.get(planId);
}

/** Reset the cached RazorPay plan-id map. Useful in tests. */
export function _resetRazorpayPlanIdCache(): void {
  _razorpayPlanIdMap = null;
}
