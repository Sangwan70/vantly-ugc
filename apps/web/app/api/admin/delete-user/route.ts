// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/**
 * Admin: permanently delete a user.
 *
 * This is a real hard delete, by explicit product decision (see the
 * migration comment in 20260904150000_admin_user_moderation.sql): deleting
 * `auth.users` cascades through `profiles` -> `subscriptions` /
 * `user_credits` / `generation_jobs` / `credit_transactions` /
 * `primitive_runs` (and everything under it) / `device_codes` / `api_keys`
 * -- all of it goes, including the credit-transaction ledger. There is no
 * recovery once this returns success. Use block-user instead when history
 * needs to be preserved and access merely suspended.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const { user_id } = body;

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Never let an admin delete another admin's account (or their own) via
  // this route -- refuse server-side rather than relying on the frontend
  // to grey the button out (AutoGPT's own equivalent safeguard is
  // frontend-only, disabling the toggle only for the platform's
  // first-created user; that doesn't hold up if the UI is bypassed).
  const { data: targetAuthUser, error: lookupError } = await admin.auth.admin.getUserById(user_id);
  if (lookupError || !targetAuthUser?.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (isAdminEmail(targetAuthUser.user.email)) {
    return NextResponse.json(
      { error: 'Refusing to delete an account listed in ADMIN_EMAILS' },
      { status: 403 },
    );
  }

  // Deleting the auth.users row cascades through profiles and everything
  // that references it (see migration comment for the full chain).
  const { error: deleteError } = await admin.auth.admin.deleteUser(user_id);
  if (deleteError) {
    return NextResponse.json(
      { error: 'Failed to delete user', details: deleteError.message },
      { status: 500 },
    );
  }

  // Best-effort audit row -- the user this describes is already gone, so
  // there's nothing sensible to roll back if this insert itself fails;
  // log and continue rather than pretending the delete didn't happen.
  await admin.from('admin_actions').insert({
    admin_email: user.email,
    action: 'delete_user',
    target_user_id: user_id,
    target_email: targetAuthUser.user.email ?? null,
  }).then(({ error }) => { if (error) console.error('Failed to record admin_actions row for delete_user:', error.message); });

  return NextResponse.json({ success: true, user_id, deleted: true });
}
