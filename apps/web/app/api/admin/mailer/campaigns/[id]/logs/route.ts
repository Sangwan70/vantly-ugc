// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const LOG_ROW_LIMIT = 200;

/**
 * Per-recipient delivery/open/click detail for one campaign, backing the
 * admin "View activity" panel. Returns aggregate counts (cheap to compute
 * client-side too, but doing it here keeps the UI from re-deriving the
 * same numbers) plus up to LOG_ROW_LIMIT individual rows, most-recent
 * first.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin = adminClient();
  const base = admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id);

  const [rowsRes, totalRes, sentRes, failedRes, suppressedRes, openedRes, clickedRes] = await Promise.all([
    admin
      .from('email_logs')
      .select('recipient_email, status, error, provider, opened_at, open_count, first_clicked_at, click_count, created_at')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false })
      .limit(LOG_ROW_LIMIT),
    base,
    admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'sent'),
    admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'failed'),
    admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'suppressed'),
    admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id).gt('open_count', 0),
    admin.from('email_logs').select('*', { count: 'exact', head: true }).eq('campaign_id', id).gt('click_count', 0),
  ]);

  if (rowsRes.error) return NextResponse.json({ error: 'Failed to load campaign activity', details: rowsRes.error.message }, { status: 500 });

  const rows = rowsRes.data ?? [];
  const summary = {
    total: totalRes.count ?? rows.length,
    sent: sentRes.count ?? 0,
    failed: failedRes.count ?? 0,
    suppressed: suppressedRes.count ?? 0,
    opened: openedRes.count ?? 0,
    clicked: clickedRes.count ?? 0,
  };

  return NextResponse.json({ summary, rows, truncated: (totalRes.count ?? rows.length) > LOG_ROW_LIMIT });
}
