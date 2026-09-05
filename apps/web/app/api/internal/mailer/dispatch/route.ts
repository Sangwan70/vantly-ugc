// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /api/internal/mailer/dispatch -- the mailer-automation-runner
 * Supabase Edge Function's cron tick target (registered in
 * 20260905130000_mailer_full_system.sql, every 15 minutes). NOT reachable
 * by a logged-in admin session -- gated by a shared secret
 * (MAILER_CRON_SECRET) instead of isAdminEmail, since this is called
 * machine-to-machine with no user in the loop. Deploying this requires
 * setting MAILER_CRON_SECRET to the same value in both this Next.js
 * app's environment and as a Supabase Function secret for
 * mailer-automation-runner (see that function's own doc comment and
 * deploy.sh) -- a manual one-time setup step, same as every other
 * webhook/service secret this app already depends on.
 *
 * Does two things on every tick: (1) sends any 'scheduled' campaign whose
 * scheduled_at has passed (via the same sendCampaignNow pipeline "Send
 * Now" uses), and (2) evaluates the two automated lifecycle triggers.
 * Both are best-effort per-item -- one failing campaign/trigger must not
 * stop the rest of the tick.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendCampaignNow } from '@/lib/mailer/send-campaign';
import { dispatchAutomatedTriggers } from '@/lib/mailer/automated-triggers';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MAILER_CRON_SECRET;
  if (!secret) return false; // fail closed -- unconfigured means "never runs", not "always runs"
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = adminClient();
  const campaignResults: { id: string; ok: boolean; error?: string }[] = [];

  const { data: due, error: dueError } = await admin
    .from('email_campaigns')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString());

  if (dueError) {
    return NextResponse.json({ error: `Failed to load scheduled campaigns: ${dueError.message}` }, { status: 500 });
  }

  for (const row of due ?? []) {
    try {
      const outcome = await sendCampaignNow(admin, row.id as string);
      campaignResults.push({ id: row.id as string, ok: outcome.ok, error: outcome.error });
    } catch (e) {
      campaignResults.push({ id: row.id as string, ok: false, error: e instanceof Error ? e.message : 'Unexpected error' });
    }
  }

  let triggerResult;
  try {
    triggerResult = await dispatchAutomatedTriggers(admin);
  } catch (e) {
    triggerResult = { sent: 0, failed: 0, skippedSuppressed: 0, errors: [e instanceof Error ? e.message : 'Unexpected error'] };
  }

  return NextResponse.json({ success: true, scheduled_campaigns: campaignResults, automated_triggers: triggerResult });
}
