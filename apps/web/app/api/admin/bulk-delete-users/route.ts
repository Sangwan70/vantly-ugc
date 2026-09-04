// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

const MAX_BULK = 200;

/**
 * Admin: bulk hard-delete users. Same irreversible cascade as
 * delete-user/route.ts, applied per user_id with partial-failure
 * tolerance -- one bad id (already deleted, not found, or an
 * ADMIN_EMAILS-protected account) doesn't abort the rest of the batch.
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
  const { user_ids } = body;

  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return NextResponse.json({ error: 'user_ids must be a non-empty array' }, { status: 400 });
  }
  if (user_ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `Refusing to delete more than ${MAX_BULK} users in one request` },
      { status: 400 },
    );
  }
  if (!user_ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return NextResponse.json({ error: 'user_ids must all be non-empty strings' }, { status: 400 });
  }

  const admin = createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const errors: { user_id: string; error: string }[] = [];
  let deletedCount = 0;

  for (const user_id of user_ids as string[]) {
    const { data: targetAuthUser, error: lookupError } = await admin.auth.admin.getUserById(user_id);
    if (lookupError || !targetAuthUser?.user) {
      errors.push({ user_id, error: 'User not found' });
      continue;
    }
    if (isAdminEmail(targetAuthUser.user.email)) {
      errors.push({ user_id, error: 'Refusing to delete an account listed in ADMIN_EMAILS' });
      continue;
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user_id);
    if (deleteError) {
      errors.push({ user_id, error: deleteError.message });
      continue;
    }
    deletedCount += 1;
    await admin.from('admin_actions').insert({
      admin_email: user.email,
      action: 'delete_user',
      target_user_id: user_id,
      target_email: targetAuthUser.user.email ?? null,
    }).then(({ error }) => { if (error) console.error('Failed to record admin_actions row for delete_user:', error.message); });
  }

  return NextResponse.json({
    success: errors.length === 0,
    deleted_count: deletedCount,
    error_count: errors.length,
    errors,
  });
}
