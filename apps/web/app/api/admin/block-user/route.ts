// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

/**
 * Admin: block or unblock a user's access, without touching their data.
 *
 * The actual enforcement is Supabase's own ban mechanism
 * (auth.admin.updateUserById ban_duration) -- AutoGPT's equivalent
 * `isBlocked` flag has no visible login enforcement behind it (it's set in
 * their DB and just... not checked anywhere obvious), so this route does
 * better by actually banning the auth user, not just recording a flag.
 * profiles.is_blocked/blocked_at/blocked_reason mirror that state purely so
 * the admin list can show it without a second round-trip to the auth admin
 * API for every row.
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
  const { user_id, blocked, reason } = body;

  if (!user_id || typeof user_id !== 'string') {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }
  if (typeof blocked !== 'boolean') {
    return NextResponse.json({ error: 'blocked must be a boolean' }, { status: 400 });
  }
  if (reason !== undefined && typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: targetAuthUser, error: lookupError } = await admin.auth.admin.getUserById(user_id);
  if (lookupError || !targetAuthUser?.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (isAdminEmail(targetAuthUser.user.email)) {
    return NextResponse.json(
      { error: 'Refusing to block an account listed in ADMIN_EMAILS' },
      { status: 403 },
    );
  }

  // ban_duration: a long fixed duration rather than a true permanent ban --
  // GoTrue's admin API models bans as a duration, not a boolean. 'none'
  // lifts it.
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: blocked ? '876000h' : 'none',
  });
  if (banError) {
    return NextResponse.json(
      { error: 'Failed to update auth ban state', details: banError.message },
      { status: 500 },
    );
  }

  await admin.from('admin_actions').insert({
    admin_email: user.email,
    action: blocked ? 'block_user' : 'unblock_user',
    target_user_id: user_id,
    target_email: targetAuthUser.user.email ?? null,
    details: reason ? { reason } : {},
  }).then(({ error }) => { if (error) console.error('Failed to record admin_actions row for block_user:', error.message); });

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      is_blocked: blocked,
      blocked_at: blocked ? new Date().toISOString() : null,
      blocked_reason: blocked ? (reason ?? null) : null,
    })
    .eq('id', user_id);
  if (profileError) {
    // The auth-level ban already succeeded (the part that actually stops
    // login) -- surface this as a partial-success warning rather than a
    // hard error, since retrying the whole request would re-run the ban
    // call harmlessly but the caller should still know the mirror is stale.
    return NextResponse.json({
      success: true,
      user_id,
      blocked,
      warning: `Auth ban updated, but profiles.is_blocked failed to sync: ${profileError.message}`,
    });
  }

  return NextResponse.json({ success: true, user_id, blocked });
}
