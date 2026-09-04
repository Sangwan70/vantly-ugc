// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { SupabaseClient } from '@supabase/supabase-js';

interface EmailGroupRow {
  type: 'manual' | 'all_users';
  members: string[];
}

const LIST_USERS_PAGE_SIZE = 1000;

/**
 * Resolve a group's actual recipient email list at send time.
 *
 * 'manual' groups just return their stored members[]. 'all_users' groups
 * are NOT a stored snapshot (see the migration's comment on email_groups
 * for why) -- this pages through every Supabase auth user via
 * auth.admin.listUsers, the same pagination-past-1000-rows pattern
 * apps/web/app/api/admin/users/route.ts already uses, and returns whoever
 * currently has a verified email. Expect this to be slow-ish and
 * memory-heavy for a very large user base; fine for Vantly's actual scale
 * today, called only when a campaign against an all_users group is
 * actually sent (not on every page load).
 */
export async function resolveGroupRecipients(
  admin: SupabaseClient,
  group: EmailGroupRow,
): Promise<string[]> {
  if (group.type === 'manual') {
    return group.members;
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
