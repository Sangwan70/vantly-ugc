// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';

interface EmailGroupRow {
  type: 'manual' | 'all_users' | 'smart';
  members: string[];
  smart_rules?: SmartRules | null;
}

export interface SmartCondition {
  field: 'plan_slug' | 'subscription_status' | 'signup_days_ago';
  op: 'eq' | 'ne' | 'in' | 'gte' | 'lte';
  value: string | number | string[];
}

export interface SmartRules {
  match: 'all' | 'any';
  conditions: SmartCondition[];
}

const LIST_USERS_PAGE_SIZE = 1000;

interface UserFacts {
  email: string;
  planSlug: string;
  subscriptionStatus: string;
  signupDaysAgo: number;
}

async function listAllUsersWithFacts(admin: SupabaseClient): Promise<UserFacts[]> {
  const { data: subRows, error: subError } = await admin
    .from('subscriptions')
    .select('user_id, plan_slug, status');
  if (subError) throw new Error(`Failed to load subscriptions for segmentation: ${subError.message}`);
  const subsByUser = new Map((subRows ?? []).map((s) => [s.user_id as string, s]));

  const facts: UserFacts[] = [];
  let page = 1;
  const now = Date.now();
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_USERS_PAGE_SIZE });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email) continue;
      const sub = subsByUser.get(u.id) as { plan_slug?: string; status?: string } | undefined;
      const createdAt = u.created_at ? new Date(u.created_at).getTime() : now;
      facts.push({
        email: u.email,
        planSlug: sub?.plan_slug ?? 'free',
        subscriptionStatus: sub?.status ?? 'none',
        signupDaysAgo: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
      });
    }
    if (users.length < LIST_USERS_PAGE_SIZE) break;
    page += 1;
  }
  return facts;
}

function factValue(facts: UserFacts, field: SmartCondition['field']): string | number {
  if (field === 'plan_slug') return facts.planSlug;
  if (field === 'subscription_status') return facts.subscriptionStatus;
  return facts.signupDaysAgo;
}

function evaluateCondition(facts: UserFacts, cond: SmartCondition): boolean {
  const actual = factValue(facts, cond.field);
  switch (cond.op) {
    case 'eq':
      return String(actual) === String(cond.value);
    case 'ne':
      return String(actual) !== String(cond.value);
    case 'in':
      return Array.isArray(cond.value) && cond.value.map(String).includes(String(actual));
    case 'gte':
      return Number(actual) >= Number(cond.value);
    case 'lte':
      return Number(actual) <= Number(cond.value);
    default:
      return false;
  }
}

/** Exported so the admin UI's "preview matches" action can show a live count/sample without duplicating this logic. */
export async function resolveSmartGroupRecipients(admin: SupabaseClient, rules: SmartRules): Promise<string[]> {
  if (!rules.conditions.length) return [];
  const allFacts = await listAllUsersWithFacts(admin);
  const matches = allFacts.filter((facts) =>
    rules.match === 'all'
      ? rules.conditions.every((c) => evaluateCondition(facts, c))
      : rules.conditions.some((c) => evaluateCondition(facts, c)),
  );
  return matches.map((f) => f.email);
}

/**
 * Resolve a group's actual recipient email list at send time.
 *
 * 'manual' groups just return their stored members[]. 'all_users' and
 * 'smart' groups are NOT a stored snapshot (see the migration's comment
 * on email_groups for why) -- resolved fresh here, every time. 'smart'
 * evaluates smart_rules against live user + subscription data (see
 * resolveSmartGroupRecipients above) rather than a materialized
 * per-member table -- correctness over that extra machinery, same
 * reasoning the original all_users design already used.
 */
export async function resolveGroupRecipients(
  admin: SupabaseClient,
  group: EmailGroupRow,
): Promise<string[]> {
  if (group.type === 'manual') {
    return group.members;
  }
  if (group.type === 'smart') {
    if (!group.smart_rules) return [];
    return resolveSmartGroupRecipients(admin, group.smart_rules);
  }

  const emails: string[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_USERS_PAGE_SIZE });
    if (error) throw new Error(`Failed to list users for all_users group: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email) emails.push(u.email);
    }
    if (users.length < LIST_USERS_PAGE_SIZE) break;
    page += 1;
  }
  return emails;
}

/**
 * Filters out every email present in email_suppressions (unsubscribed,
 * bounced, complained, or manually suppressed) -- the actual enforcement
 * point for the Mailer audit's top-priority gap. Called on the final,
 * deduped recipient list right before sending, for BOTH campaigns and
 * automated triggers -- there is no other path to Resend/Postmark/SES
 * that skips this.
 */
export async function filterSuppressed(admin: SupabaseClient, emails: string[]): Promise<{ allowed: string[]; suppressed: string[] }> {
  if (emails.length === 0) return { allowed: [], suppressed: [] };
  const { data, error } = await admin.from('email_suppressions').select('email');
  if (error) throw new Error(`Failed to load suppression list: ${error.message}`);
  const suppressedSet = new Set((data ?? []).map((r) => (r.email as string).toLowerCase()));
  const allowed: string[] = [];
  const suppressed: string[] = [];
  for (const email of emails) {
    if (suppressedSet.has(email.toLowerCase())) suppressed.push(email);
    else allowed.push(email);
  }
  return { allowed, suppressed };
}
