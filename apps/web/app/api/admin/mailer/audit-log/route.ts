// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/** Read-only viewer for mailer_audit_log (see lib/mailer/audit-log.ts). Optional ?action= substring filter, ?limit= up to MAX_PAGE_SIZE. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const url = new URL(req.url);
  const actionFilter = url.searchParams.get('action')?.trim() || '';
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_PAGE_SIZE) : PAGE_SIZE;

  let query = adminClient().from('mailer_audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (actionFilter) query = query.ilike('action', `%${actionFilter}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Failed to load audit log', details: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}
