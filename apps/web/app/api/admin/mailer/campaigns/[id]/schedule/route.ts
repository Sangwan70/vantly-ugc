// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { logMailerAudit } from '@/lib/mailer/audit-log';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Moves a draft campaign to status='scheduled' with a future scheduled_at.
 * Actual sending happens later, off the mailer-automation-runner cron
 * tick (see app/api/internal/mailer/dispatch/route.ts) via the same
 * sendCampaignNow pipeline "Send Now" uses -- this route only sets the
 * intent, never sends anything itself.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const scheduledAtRaw = typeof body?.scheduled_at === 'string' ? body.scheduled_at : '';
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'scheduled_at must be a valid date/time' }, { status: 400 });
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'scheduled_at must be in the future' }, { status: 400 });
  }

  const admin = adminClient();
  const { data: existing, error: fetchError } = await admin.from('email_campaigns').select('status').eq('id', id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: `Cannot schedule a campaign with status '${existing.status}'` }, { status: 409 });
  }

  const { data, error } = await admin
    .from('email_campaigns')
    .update({ status: 'scheduled', schedule_type: 'scheduled', scheduled_at: scheduledAt.toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to schedule campaign', details: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'This campaign is no longer a draft' }, { status: 409 });

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'campaign.schedule', targetType: 'campaign', targetId: id, metadata: { scheduled_at: scheduledAt.toISOString() } });

  return NextResponse.json({ success: true, campaign: data });
}
