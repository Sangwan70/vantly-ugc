// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
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
 * Cancels a draft or still-pending scheduled campaign. Once a campaign
 * has actually started sending (status='sending'/'sent'/'failed') this
 * refuses -- cancellation only makes sense before sendCampaignNow has
 * claimed it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from('email_campaigns')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .in('status', ['draft', 'scheduled'])
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to cancel campaign', details: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'This campaign can no longer be cancelled (already sending, sent, or failed)' }, { status: 409 });

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'campaign.cancel', targetType: 'campaign', targetId: id });

  return NextResponse.json({ success: true, campaign: data });
}
