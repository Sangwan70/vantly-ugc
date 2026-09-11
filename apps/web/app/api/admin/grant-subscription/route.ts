import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/** 'free' is handled separately below (see the downgrade branch) -- it's
 * not a purchasable tier with a credit allowance the way the paid ones
 * are, so it's handled as its own branch rather than going through the
 * plans-table lookup below (that would let it silently pass the paid-plan
 * branch's upsert/reset_monthly_credits flow with a 0 allowance, which is
 * a different, wronger operation than an actual downgrade). */
const DOWNGRADE_SLUG = 'free';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { user_id, plan_slug } = body;

  if (!user_id || !plan_slug) {
    return NextResponse.json(
      { error: 'user_id and plan_slug are required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Downgrade to free: cancel the subscription row and zero the monthly
  // allowance, but never touch purchased_balance -- credits a user already
  // paid for (PAYG top-ups) are never clawed back on a plan change, same
  // rule webhook-stripe/webhook-razorpay's own downgrade handlers follow.
  if (plan_slug === DOWNGRADE_SLUG) {
    const { error: cancelError } = await admin
      .from('subscriptions')
      .update({ plan_slug: 'free', status: 'canceled', cancel_at_period_end: false })
      .eq('user_id', user_id);
    if (cancelError) {
      return NextResponse.json(
        { error: 'Failed to downgrade subscription', details: cancelError.message },
        { status: 500 },
      );
    }
    const { error: creditsError } = await admin
      .from('user_credits')
      .update({ monthly_credits_remaining: 0 })
      .eq('user_id', user_id);
    if (creditsError) {
      return NextResponse.json(
        { error: 'Downgraded subscription, but failed to zero monthly credits', details: creditsError.message },
        { status: 500 },
      );
    }
    await admin.from('admin_actions').insert({
      admin_email: user.email,
      action: 'downgrade_to_free',
      target_user_id: user_id,
    }).then(({ error }) => { if (error) console.error('Failed to record admin_actions row for downgrade_to_free:', error.message); });

    return NextResponse.json({ success: true, user_id, plan_slug: DOWNGRADE_SLUG, monthly_credits: 0 });
  }

  // Look up the plan's live definition from the canonical `plans` table
  // (the Admin Plans panel, see 20260904160000_plans_table.sql) instead of
  // a hardcoded credit map -- so any active plan an admin creates there
  // (e.g. a tier priced specifically for offline/bank-transfer customers)
  // is assignable here immediately, with no code change. Deliberately not
  // filtered to is_purchasable: this route is the OFFLINE-payment path --
  // an admin comping or manually invoicing a user is exactly the case
  // where a plan marked "not selectable in self-serve checkout" still
  // needs to be assignable by hand. is_active is still required: an
  // inactive/deprecated tier (e.g. the legacy 'newby' plan) is kept around
  // to resolve existing subscribers, not to hand out to someone new.
  const { data: plan, error: planLookupError } = await admin
    .from('plans')
    .select('slug, monthly_credits, is_active')
    .eq('slug', plan_slug)
    .maybeSingle();

  if (planLookupError) {
    return NextResponse.json(
      { error: 'Failed to look up plan', details: planLookupError.message },
      { status: 500 },
    );
  }
  if (!plan || !plan.is_active) {
    const { data: activePlans } = await admin
      .from('plans')
      .select('slug')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    const validSlugs = [...(activePlans ?? []).map((p) => p.slug), DOWNGRADE_SLUG];
    return NextResponse.json(
      { error: `Invalid plan_slug. Must be one of: ${validSlugs.join(', ')}` },
      { status: 400 },
    );
  }
  const monthlyCredits = plan.monthly_credits;

  // Upsert subscription record
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error: subError } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id,
        plan_slug,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (subError) {
    return NextResponse.json(
      { error: 'Failed to update subscription', details: subError.message },
      { status: 500 },
    );
  }

  // Reset monthly credits to the plan's allowance
  const { error: rpcError } = await admin.rpc('reset_monthly_credits', {
    p_user_id: user_id,
    p_allowance: monthlyCredits,
  });

  if (rpcError) {
    // If rpc fails, try direct upsert on user_credits as fallback
    await admin
      .from('user_credits')
      .upsert(
        {
          user_id,
          monthly_credits_remaining: monthlyCredits,
        },
        { onConflict: 'user_id' },
      );
  }

  return NextResponse.json({
    success: true,
    user_id,
    plan_slug,
    monthly_credits: monthlyCredits,
  });
}
