// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /v1/credits-check — the authenticated user's billing state: plan
 * details, credit balances, and feature limits based on their subscription
 * tier.
 *
 * Ported from supabase/functions/credits-check (a Supabase Edge Function).
 * This self-hosted stack's gateway (supabase/self-host-gateway/nginx.conf)
 * deliberately only proxies /auth/v1, /rest/v1, /storage/v1 — there is no
 * Edge Functions runtime behind it, so apps/web calling that Edge Function
 * 404'd here with "This gateway only serves ...". api-v2 already has its own
 * auth middleware and a service-role DB client, so this reimplements the
 * same logic as a plain route instead of standing up a whole separate Deno
 * runtime for one function. supabase/functions/credits-check is unchanged
 * and still used by the hosted (non-self-hosted) deployment — keep the two
 * in sync if the plan/credit logic ever changes; they read the same tables
 * and RPC.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../server.js';
import { isAdminEmail } from '../../lib/admin-allowlist.js';

// ── Plan tier definitions — MUST mirror supabase/functions/credits-check ──
//
// Read from the canonical `plans` table (the Admin Plans panel; see
// 20260904160000_plans_table.sql) instead of a hardcoded map, so a plan an
// admin creates or edits there — including one priced specifically for
// offline/bank-transfer customers assigned via /api/admin/grant-subscription
// — gets correct generation-time limits (video duration, concurrency, model
// access) without a code change here.
//
// ALL rows are read, not just is_active ones: a subscription can carry a
// deprecated plan_slug (e.g. legacy 'newby', is_active=false — no longer
// offered to new users, but real grandfathered subscribers still have it),
// and that must keep resolving to its real limits rather than silently
// falling back to Free.
//
// 'payg' (pay-as-you-go: purchased credits, no subscription) is NEVER a row
// in `plans` — it's a synthetic tier this route assigns below when a
// subscription-less user has a positive purchased_balance — so its config
// and rank are injected by hand, not read from the DB.
interface PlanConfig {
  name: string;
  monthly_credits: number;
  max_concurrent_jobs: number;
  max_video_duration: number; // seconds
}

const PAYG_SLUG = 'payg';
const PAYG_CONFIG: PlanConfig = { name: 'Pay As You Go', monthly_credits: 0, max_concurrent_jobs: 2, max_video_duration: 15 };
// Historically ordered directly above 'newby' and below the paid tiers
// (TIER_ORDER used to be a fixed ['free','newby','payg','starter',...]
// array); ranked here as "half a step" above whichever of free/newby the
// live catalog puts highest, so that relative ordering survives without
// depending on a specific sort_order value existing for either.
const FREE_SLUG = 'free';
const FALLBACK_FREE_CONFIG: PlanConfig = { name: 'Free', monthly_credits: 0, max_concurrent_jobs: 1, max_video_duration: 5 };

interface PlanCatalog {
  configBySlug: Map<string, PlanConfig>;
  rankBySlug: Map<string, number>;
}

async function loadPlanCatalog(): Promise<PlanCatalog> {
  const { data: rows } = await supabase
    .from('plans')
    .select('slug, display_name, monthly_credits, max_concurrent_jobs, max_video_duration_seconds, sort_order');

  const configBySlug = new Map<string, PlanConfig>();
  const rankBySlug = new Map<string, number>();
  for (const row of rows ?? []) {
    configBySlug.set(row.slug, {
      name: row.display_name,
      monthly_credits: row.monthly_credits ?? 0,
      max_concurrent_jobs: row.max_concurrent_jobs ?? 1,
      // Nullable in the table (e.g. an image-only or audio-only plan might
      // never set it); fall back to Free's original default rather than 0,
      // which would zero out video access entirely for a plan that simply
      // never set this column.
      max_video_duration: row.max_video_duration_seconds ?? FALLBACK_FREE_CONFIG.max_video_duration,
    });
    rankBySlug.set(row.slug, row.sort_order ?? 0);
  }

  // Defensive fallback: `plans` should always have an active 'free' row
  // (it's the seed migration's first row), but if it's ever missing or the
  // query fails, every unknown-tier lookup below must still resolve to
  // something safe rather than throw.
  if (!configBySlug.has(FREE_SLUG)) {
    configBySlug.set(FREE_SLUG, FALLBACK_FREE_CONFIG);
    rankBySlug.set(FREE_SLUG, 0);
  }

  configBySlug.set(PAYG_SLUG, PAYG_CONFIG);
  const freeRank = rankBySlug.get(FREE_SLUG) ?? 0;
  const newbyRank = rankBySlug.has('newby') ? rankBySlug.get('newby')! : freeRank;
  rankBySlug.set(PAYG_SLUG, Math.max(freeRank, newbyRank) + 0.5);

  return { configBySlug, rankBySlug };
}

function getPlanConfig(catalog: PlanCatalog, tier: string): PlanConfig {
  return catalog.configBySlug.get(tier) ?? catalog.configBySlug.get(FREE_SLUG) ?? FALLBACK_FREE_CONFIG;
}

function tierRank(catalog: PlanCatalog, tier: string): number {
  return catalog.rankBySlug.get(tier) ?? 0;
}

export async function creditsCheckRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const unlimited = isAdminEmail((req as { userEmail?: string }).userEmail);

  try {
    const [{ data: subscription, error: subError }, catalog] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('plan_slug, status, current_period_end, trial_ends_at, cancel_at_period_end')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadPlanCatalog(),
    ]);

    if (subError) {
      res.status(500).json({ error: 'server_error', error_description: 'Failed to fetch subscription data' });
      return;
    }

    let planSlug: string = subscription?.plan_slug ?? 'free';
    const subscriptionStatus: string = subscription?.status ?? 'active';
    const currentPeriodEnd: string | null = subscription?.current_period_end ?? null;
    const trialEndsAt: string | null = subscription?.trial_ends_at ?? null;

    const now = new Date();
    const trialActive =
      subscriptionStatus === 'trialing' && trialEndsAt !== null && new Date(trialEndsAt) > now;

    let monthlyRemaining = 0;
    let purchasedBalance = 0;

    const { data: creditData, error: creditError } = await supabase.rpc('get_credit_balance', {
      p_user_id: userId,
    });

    if (creditError) {
      // If no credit record exists (new user), default to zero — same
      // tolerance the Edge Function had.
      const isNotFound = creditError.message?.includes('USER_NOT_FOUND') ?? false;
      if (!isNotFound) {
        res.status(500).json({ error: 'server_error', error_description: 'Failed to fetch credit balance' });
        return;
      }
    } else if (creditData) {
      monthlyRemaining = creditData.monthly_credits_remaining ?? 0;
      purchasedBalance = creditData.purchased_balance ?? 0;
    }

    // Upgrade "free" to "payg" if the user has purchased credits but no subscription.
    if (planSlug === 'free' && purchasedBalance > 0) {
      planSlug = 'payg';
    }

    const planConfig = getPlanConfig(catalog, planSlug);

    const userRank = tierRank(catalog, planSlug);
    const { data: availableModels } = await supabase
      .from('models')
      .select('slug, min_plan_tier')
      .eq('is_active', true)
      .order('slug');

    const modelsAvailable = (availableModels ?? [])
      .filter((m: { min_plan_tier: string }) => tierRank(catalog, m.min_plan_tier) <= userRank)
      .map((m: { slug: string }) => m.slug);

    // ── Self-healing: allocate monthly credits if a billing webhook was missed ──
    // Only self-heal once the billing period has actually rolled over, so a
    // user who legitimately spent everything mid-cycle doesn't get a free refill.
    const cancelAtPeriodEnd = subscription?.cancel_at_period_end ?? false;
    if (
      planConfig.monthly_credits > 0 &&
      monthlyRemaining === 0 &&
      subscriptionStatus === 'active' &&
      !cancelAtPeriodEnd
    ) {
      const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
      if (periodEnd !== null && periodEnd < now) {
        const newPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { error: healError } = await supabase
          .from('user_credits')
          .update({ monthly_credits_remaining: planConfig.monthly_credits })
          .eq('user_id', userId);

        if (!healError) {
          monthlyRemaining = planConfig.monthly_credits;
          await supabase.from('subscriptions').update({ current_period_end: newPeriodEnd }).eq('user_id', userId);
          await supabase.from('credit_transactions').insert({
            user_id: userId,
            type: 'monthly_reset',
            amount: planConfig.monthly_credits,
            bucket: 'monthly',
            running_monthly_balance: planConfig.monthly_credits,
            running_purchased_balance: purchasedBalance,
            description: `Self-healed: monthly credit allocation for ${planSlug} plan (period expired)`,
          });
        }
      }
    }

    res.status(200).json({
      user_id: userId,
      plan: {
        tier: planSlug,
        name: planConfig.name,
        status: subscriptionStatus,
        cancel_at_period_end: cancelAtPeriodEnd,
        trial_active: trialActive,
        trial_ends_at: trialActive ? trialEndsAt : null,
        current_period_end: currentPeriodEnd,
      },
      credits: {
        monthly_remaining: monthlyRemaining,
        monthly_allowance: planConfig.monthly_credits,
        purchased: purchasedBalance,
        total: monthlyRemaining + purchasedBalance,
        // Admins (ADMIN_EMAILS): the dashboard shows "Unlimited" regardless of
        // the raw total above. See lib/admin-allowlist.ts + routes/v1/skills.ts
        // (preflightCreditCheck/quoteSkillRoute) for the matching bypass.
        unlimited,
      },
      limits: {
        max_concurrent_jobs: planConfig.max_concurrent_jobs,
        max_video_duration: planConfig.max_video_duration,
        models_available: modelsAvailable,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: 'server_error',
      error_description: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
