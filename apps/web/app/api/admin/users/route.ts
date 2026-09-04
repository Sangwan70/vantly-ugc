import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { mapPrimitiveRunToJob, type AdminJob } from '@/lib/admin-generations';

export async function GET(req: NextRequest) {
  const includeAll = req.nextUrl.searchParams.get('all') === '1';
  // Authenticate the current user
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Admin client bypasses RLS
  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // listUsers caps at perPage=1000 per call. With ~3.4k auth users in
  // prod, a single call leaves most users out of the lookup map →
  // anyone past row 1000 displays as "(no email)" even though their
  // auth.users.email exists. Paginate until empty.
  async function fetchAllAuthUsers() {
    type AuthUser = Awaited<ReturnType<typeof admin.auth.admin.listUsers>>['data']['users'][number];
    const all: AuthUser[] = [];
    let page = 1;
    // Hard cap so a buggy server can't loop forever.
    for (let safety = 0; safety < 50; safety++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const batch = data?.users ?? [];
      all.push(...batch);
      if (batch.length < 1000) break;
      page += 1;
    }
    return all;
  }

  // PostgREST caps every data-API select at max_rows (1000). Paginate a select
  // (built fresh per page so .range() applies cleanly) until a short batch.
  async function fetchAllRows<T>(
    makeQuery: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> {
    const PAGE = 1000;
    const all: T[] = [];
    for (let safety = 0; safety < 50; safety++) {
      const from = safety * PAGE;
      const { data, error } = await makeQuery(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    return all;
  }

  // Fetch all data sources in parallel using admin client
  // The PostgREST data API caps every select at max_rows (1000). With ~3.4k
  // users a single subscriptions/user_credits select silently dropped every row
  // past 1000, so subscribed users beyond that window vanished from the list and
  // their (correctly stored) credits rendered as 0 — this is why an admin grant
  // could succeed yet the row still showed 0. Paginate those two per-user selects
  // (each bounded by the user count) like fetchAllAuthUsers does for auth.users.
  const [authUsers, profiles, subscriptions, credits, jobsRes, primitiveRunsRes] =
    await Promise.all([
      fetchAllAuthUsers().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to fetch auth users: ${msg}`);
      }),
      fetchAllRows((from, to) =>
        admin
          .from('profiles')
          .select('id, is_blocked, blocked_at, blocked_reason')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        admin
          .from('subscriptions')
          .select(
            'user_id, plan_slug, status, created_at, current_period_start, current_period_end',
          )
          .order('user_id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        admin
          .from('user_credits')
          .select('user_id, monthly_credits_remaining, purchased_balance')
          .order('user_id', { ascending: true })
          .range(from, to),
      ),
      // NOTE: generation_jobs + primitive_runs are still the 1000 most-recent
      // rows (they only feed the per-user gens/used columns, capped 100/user).
      // Fully paginating them would scan tens of thousands of rows on every admin
      // load; a per-user DB aggregation is the right follow-up if the gens/used
      // columns must be exact for less-recently-active users.
      admin
        .from('generation_jobs')
        .select(
          'user_id, id, model_slug, operation, status, prompt, output_media_url, credit_cost, error_message, error_code, created_at, completed_at',
        )
        .order('created_at', { ascending: false }),
      admin
        .from('primitive_runs')
        .select('user_id, id, primitive_id, status, input, created_at, finished_at')
        .order('created_at', { ascending: false }),
    ]);

  // Index lookup maps
  const authUsersById = new Map(authUsers.map((u) => [u.id, u]));

  const profilesById = new Map(profiles.map((p) => [p.id, p]));

  const subscriptionsByUser = new Map(
    subscriptions.map((s) => [s.user_id, s]),
  );

  const creditsByUser = new Map(
    credits.map((c) => [c.user_id, c]),
  );

  // Merge legacy generation_jobs + vNext primitive_runs into one per-user
  // list, newest first, capped at 100.
  const jobsByUser = new Map<string, AdminJob[]>();
  const pushJob = (uid: string, j: AdminJob) => {
    const list = jobsByUser.get(uid) ?? [];
    list.push(j);
    jobsByUser.set(uid, list);
  };
  for (const job of (jobsRes.data ?? []) as AdminJob[]) pushJob(job.user_id, job);
  for (const run of primitiveRunsRes.data ?? []) {
    pushJob(run.user_id, mapPrimitiveRunToJob(run as Parameters<typeof mapPrimitiveRunToJob>[0]));
  }
  for (const [uid, list] of jobsByUser) {
    list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    if (list.length > 100) jobsByUser.set(uid, list.slice(0, 100));
  }

  // Historically this only showed subscribed users -- a free signup who
  // never subscribed was invisible to admins entirely, which blocked
  // block/delete from reaching a real chunk of the user base. ?all=1 widens
  // the id set to every signed-up auth user; the default stays
  // subscription-only so existing callers see no behavior change.
  const userIds = includeAll
    ? Array.from(authUsersById.keys())
    : Array.from(subscriptionsByUser.keys());

  const users = userIds.map((userId) => {
    const authUser = authUsersById.get(userId);
    const subscription = subscriptionsByUser.get(userId) ?? null;
    const profile = profilesById.get(userId);
    const credits = creditsByUser.get(userId);
    const jobs = jobsByUser.get(userId) ?? [];

    // Net credits: only count completed jobs (failed ones are refunded)
    const totalCreditsUsed = jobs
      .filter((j) => j.status === 'completed')
      .reduce((sum, j) => sum + (j.credit_cost ?? 0), 0);

    let monthsSubscribed = 0;
    if (subscription?.created_at) {
      const subStart = new Date(subscription.created_at);
      const now = new Date();
      monthsSubscribed = Math.max(
        0,
        (now.getFullYear() - subStart.getFullYear()) * 12 +
          (now.getMonth() - subStart.getMonth()),
      );
    }

    return {
      id: userId,
      email: authUser?.email ?? null,
      display_name: authUser?.user_metadata?.full_name ?? null,
      created_at: authUser?.created_at ?? null,
      is_blocked: profile?.is_blocked ?? false,
      blocked_at: profile?.blocked_at ?? null,
      blocked_reason: profile?.blocked_reason ?? null,
      subscription: subscription
        ? {
            plan_slug: subscription.plan_slug,
            status: subscription.status,
            created_at: subscription.created_at,
            current_period_end: subscription.current_period_end,
          }
        : null,
      credits: credits
        ? {
            monthly_credits_remaining: credits.monthly_credits_remaining,
            purchased_balance: credits.purchased_balance,
          }
        : null,
      jobs: jobs.map((j) => ({
        id: j.id,
        model_slug: j.model_slug,
        operation: j.operation,
        status: j.status,
        prompt: j.prompt,
        output_media_url: j.output_media_url,
        credit_cost: j.credit_cost,
        error_message: j.error_message,
        error_code: j.error_code,
        created_at: j.created_at,
      })),
      computed: {
        months_subscribed: monthsSubscribed,
        total_credits_used: totalCreditsUsed,
        // jobs is already sorted desc by created_at, so [0] is the latest.
        last_creation_at: jobs[0]?.created_at ?? null,
        total_creations: jobs.length,
      },
    };
  });

  return NextResponse.json({ users });
}
