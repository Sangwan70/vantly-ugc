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
const TIER_ORDER: string[] = ['free', 'newby', 'payg', 'starter', 'creator', 'pro_plus'];

function tierRank(tier: string): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 ? idx : 0;
}

interface PlanConfig {
  name: string;
  monthly_credits: number;
  max_concurrent_jobs: number;
  max_video_duration: number; // seconds
}

const PLAN_CONFIGS: Record<string, PlanConfig> = {
  free:     { name: 'Free',          monthly_credits: 0,     max_concurrent_jobs: 1,  max_video_duration: 5  },
  payg:     { name: 'Pay As You Go', monthly_credits: 0,     max_concurrent_jobs: 2,  max_video_duration: 15 },
  newby:    { name: 'Newby',         monthly_credits: 1300,  max_concurrent_jobs: 2,  max_video_duration: 10 },
  starter:  { name: 'Creator',       monthly_credits: 3900,  max_concurrent_jobs: 3,  max_video_duration: 10 },
  creator:  { name: 'Pro',           monthly_credits: 6900,  max_concurrent_jobs: 5,  max_video_duration: 15 },
  pro_plus: { name: 'Pro Plus',      monthly_credits: 12900, max_concurrent_jobs: 10, max_video_duration: 15 },
};

function getPlanConfig(tier: string): PlanConfig {
  return PLAN_CONFIGS[tier] ?? PLAN_CONFIGS.free;
}

export async function creditsCheckRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const unlimited = isAdminEmail((req as { userEmail?: string }).userEmail);

  try {
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('plan_slug, status, current_period_end, trial_ends_at, cancel_at_period_end')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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

    const planConfig = getPlanConfig(planSlug);

    const userRank = tierRank(planSlug);
    const { data: availableModels } = await supabase
      .from('models')
      .select('slug, min_plan_tier')
      .eq('is_active', true)
      .order('slug');

    const modelsAvailable = (availableModels ?? [])
      .filter((m: { min_plan_tier: string }) => tierRank(m.min_plan_tier) <= userRank)
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
