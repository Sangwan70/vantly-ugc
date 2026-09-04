// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { getEffectiveSenderConfig } from '@/lib/mailer/sender-config';
import { renderTemplate } from '@/lib/mailer/render-template';
import { resolveGroupRecipients } from '@/lib/mailer/resolve-recipients';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Resend's batch API accepts at most 100 emails per call. This route sends
// synchronously from within the request handler (no queue) -- deliberate,
// matching the plan document's own reasoning that Vantly's existing
// pg_cron + edge-function dispatch pattern already covers recurring/
// large-batch sends whenever that's actually wanted, so building a second
// async send pipeline for v1 isn't worth it. The tradeoff is a hard cap on
// how large a single "send now" can be, so one campaign can't tie up a
// route handler indefinitely.
const RESEND_BATCH_SIZE = 100;
const MAX_SYNC_RECIPIENTS = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const admin: SupabaseClient = adminClient();

  const { data: campaign, error: fetchError } = await admin
    .from('email_campaigns')
    .select('*, email_templates(subject, html_content, text_content), email_groups(type, members)')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  // Resolve recipients BEFORE claiming the campaign, so a resolution
  // failure (e.g. listUsers erroring) never leaves it stuck in 'sending'.
  let recipients: string[] = [...(campaign.recipient_emails ?? [])];
  if (campaign.email_groups) {
    try {
      const groupRecipients = await resolveGroupRecipients(admin, campaign.email_groups);
      recipients.push(...groupRecipients);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to resolve group recipients' }, { status: 500 });
    }
  }
  recipients = Array.from(new Set(recipients.map((e) => e.toLowerCase())));

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'This campaign has no recipients' }, { status: 400 });
  }
  if (recipients.length > MAX_SYNC_RECIPIENTS) {
    return NextResponse.json(
      { error: `This campaign has ${recipients.length} recipients, over the ${MAX_SYNC_RECIPIENTS}-recipient synchronous send cap. Split it into smaller groups/campaigns.` },
      { status: 400 },
    );
  }
  if (!campaign.email_templates) {
    return NextResponse.json({ error: 'This campaign\'s template no longer exists' }, { status: 400 });
  }

  const sender = await getEffectiveSenderConfig();
  if (!sender.apiKey) {
    return NextResponse.json({ error: 'Email is not configured -- set RESEND_API_KEY or a mailer_config override in Settings -> Mailer' }, { status: 503 });
  }

  // Atomically claim the campaign: only succeeds if it's still 'draft',
  // which stops two concurrent "Send" clicks from both sending it.
  const { data: claimed, error: claimError } = await admin
    .from('email_campaigns')
    .update({ status: 'sending' })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) {
    return NextResponse.json({ error: 'This campaign has already been sent or is currently sending' }, { status: 409 });
  }

  const template = campaign.email_templates as { subject: string; html_content: string; text_content: string | null };
  const templateVars: Record<string, string> = {};
  if (campaign.template_vars && typeof campaign.template_vars === 'object') {
    for (const [k, v] of Object.entries(campaign.template_vars as Record<string, unknown>)) {
      if (typeof v === 'string') templateVars[k] = v;
    }
  }

  const resend = new Resend(sender.apiKey);
  let totalSent = 0;
  let totalFailed = 0;

  for (const batch of chunk(recipients, RESEND_BATCH_SIZE)) {
    const payload = batch.map((email) => {
      const vars = { ...templateVars, email };
      return {
        from: sender.from,
        to: email,
        replyTo: sender.replyTo ?? undefined,
        subject: renderTemplate(template.subject, vars),
        html: renderTemplate(template.html_content, vars),
        text: template.text_content ? renderTemplate(template.text_content, vars) : undefined,
      };
    });

    try {
      // Resend's batch API is effectively all-or-nothing per call for our
      // purposes here (no per-recipient delivery status comes back
      // synchronously -- that requires webhooks, out of scope for this
      // pass, see the migration's comment on email_campaigns) -- a thrown
      // error counts the whole chunk as failed, otherwise the whole chunk
      // counts as sent.
      await resend.batch.send(payload);
      totalSent += batch.length;
    } catch {
      totalFailed += batch.length;
    }
  }

  const finalStatus = totalSent > 0 ? 'sent' : 'failed';
  const { data: updated, error: updateError } = await admin
    .from('email_campaigns')
    .update({
      status: finalStatus,
      total_recipients: recipients.length,
      total_sent: totalSent,
      total_failed: totalFailed,
      sent_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (totalSent > 0) {
    // Best-effort -- a failure here shouldn't make an otherwise-successful
    // send look like it failed.
    await admin.rpc('increment_template_sent_count', { p_template_id: campaign.template_id, p_amount: totalSent }).then(
      () => {},
      () => {},
    );
  }

  if (updateError) {
    return NextResponse.json({ error: 'Send completed but failed to save campaign status', details: updateError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, campaign: updated, total_sent: totalSent, total_failed: totalFailed });
}
