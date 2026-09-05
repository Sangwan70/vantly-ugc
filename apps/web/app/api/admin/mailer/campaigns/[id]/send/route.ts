// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { sendCampaignNow } from '@/lib/mailer/send-campaign';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * "Send Now" -- admin-triggered immediate send. The actual pipeline
 * (resolve recipients, suppression filtering, per-recipient email_logs +
 * tracking, provider dispatch) lives in lib/mailer/send-campaign.ts,
 * shared with the internal cron dispatcher that sends 'scheduled'
 * campaigns once their time arrives (app/api/internal/mailer/dispatch).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin: SupabaseClient = adminClient();
  const outcome = await sendCampaignNow(admin, id, { id: user.id, email: user.email });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.error?.includes('already been sent') ? 409 : 400 });
  }

  const { data: updated } = await admin.from('email_campaigns').select('*').eq('id', id).single();
  return NextResponse.json({
    success: true,
    campaign: updated,
    total_sent: outcome.totalSent,
    total_failed: outcome.totalFailed,
    total_suppressed: outcome.totalSuppressed,
  });
}
