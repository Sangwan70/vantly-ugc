// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * The actual campaign-send pipeline, factored out so both the admin
 * "Send Now" route (app/api/admin/mailer/campaigns/[id]/send/route.ts,
 * user-auth-gated) and the internal cron dispatcher (app/api/internal/
 * mailer/dispatch/route.ts, shared-secret-gated, called by the
 * mailer-automation-runner edge function for 'scheduled' campaigns) run
 * the exact same logic -- resolve recipients, filter suppressions, create
 * a real per-recipient email_logs row, inject tracking + the mandatory
 * unsubscribe footer, send via whichever provider is configured, record
 * outcomes. One send path, not two copies to keep in sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveSenderConfig } from './sender-config';
import { getProviderSender } from './providers';
import { renderTemplate } from './render-template';
import { resolveGroupRecipients, filterSuppressed } from './resolve-recipients';
import { finalizeOutboundHtml } from './tracking';
import { logMailerAudit } from './audit-log';

// Same synchronous-send-only posture as the original v1 route -- see
// 20260904180000_mailer_core.sql's COMMENT ON TABLE. Still no async queue;
// a 'scheduled' campaign is just one whose send is deferred to a cron
// tick rather than an admin's click, not a different execution model.
const MAX_SYNC_RECIPIENTS = 500;

export interface SendCampaignOutcome {
  ok: boolean;
  error?: string;
  totalRecipients?: number;
  totalSent?: number;
  totalFailed?: number;
  totalSuppressed?: number;
}

export async function sendCampaignNow(
  admin: SupabaseClient,
  campaignId: string,
  actor?: { id: string | null; email: string | null },
): Promise<SendCampaignOutcome> {
  const { data: campaign, error: fetchError } = await admin
    .from('email_campaigns')
    .select('*, email_templates(subject, html_content, text_content), email_groups(type, members, smart_rules), coupons:featured_coupon_id(code)')
    .eq('id', campaignId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (!campaign.email_templates) return { ok: false, error: "This campaign's template no longer exists" };

  let recipients: string[] = [...(campaign.recipient_emails ?? [])];
  if (campaign.email_groups) {
    try {
      recipients.push(...(await resolveGroupRecipients(admin, campaign.email_groups)));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to resolve group recipients' };
    }
  }
  recipients = Array.from(new Set(recipients.map((e) => e.toLowerCase())));

  if (recipients.length === 0) return { ok: false, error: 'This campaign has no recipients' };

  const { allowed, suppressed } = await filterSuppressed(admin, recipients);
  if (allowed.length === 0) {
    return { ok: false, error: `All ${suppressed.length} recipient(s) are unsubscribed/suppressed -- nothing to send`, totalSuppressed: suppressed.length };
  }
  if (allowed.length > MAX_SYNC_RECIPIENTS) {
    return {
      ok: false,
      error: `This campaign has ${allowed.length} sendable recipients, over the ${MAX_SYNC_RECIPIENTS}-recipient synchronous send cap. Split it into smaller groups/campaigns.`,
    };
  }

  const sender = await getEffectiveSenderConfig();
  if (!sender.configured) {
    return { ok: false, error: `Email is not configured -- ${sender.provider} needs credentials in Settings -> Mailer` };
  }
  let provider;
  try {
    provider = getProviderSender(sender);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Mailer provider is misconfigured' };
  }

  // Atomically claim the campaign: only succeeds from 'draft' or
  // 'scheduled', which stops a concurrent "Send Now" click and a cron
  // tick (or two overlapping cron ticks) from both sending it.
  const { data: claimed, error: claimError } = await admin
    .from('email_campaigns')
    .update({ status: 'sending' })
    .eq('id', campaignId)
    .in('status', ['draft', 'scheduled'])
    .select('id')
    .maybeSingle();
  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed) return { ok: false, error: 'This campaign has already been sent, is currently sending, or was cancelled' };

  const template = campaign.email_templates as { subject: string; html_content: string; text_content: string | null };
  const templateVars: Record<string, string> = {};
  if (campaign.template_vars && typeof campaign.template_vars === 'object') {
    for (const [k, v] of Object.entries(campaign.template_vars as Record<string, unknown>)) {
      if (typeof v === 'string') templateVars[k] = v;
    }
  }
  const couponCode = (campaign as { coupons?: { code: string } | null }).coupons?.code;
  if (couponCode) templateVars.coupon_code = couponCode;

  // One email_logs row per recipient up front (status 'pending') so every
  // recipient this send targets is recorded even if the provider call
  // itself throws before returning a per-item result -- and so each row's
  // DB-generated tracking_token is available before building that
  // recipient's personalized HTML.
  const { data: logRows, error: logInsertError } = await admin
    .from('email_logs')
    .insert(allowed.map((email) => ({ campaign_id: campaignId, recipient_email: email, status: 'pending' as const })))
    .select('id, recipient_email, tracking_token');
  if (logInsertError) {
    await admin.from('email_campaigns').update({ status: 'failed' }).eq('id', campaignId);
    return { ok: false, error: `Failed to prepare send: ${logInsertError.message}` };
  }
  if (suppressed.length > 0) {
    await admin.from('email_logs').insert(suppressed.map((email) => ({ campaign_id: campaignId, recipient_email: email, status: 'suppressed' as const })));
  }

  const emails = (logRows ?? []).map((row) => {
    const vars = { ...templateVars, email: row.recipient_email as string };
    const html = finalizeOutboundHtml(renderTemplate(template.html_content, vars), row.tracking_token as string, row.recipient_email as string, { logoUrl: sender.logoUrl, footerText: sender.footerText });
    return {
      to: row.recipient_email as string,
      from: sender.from,
      replyTo: sender.replyTo,
      subject: renderTemplate(template.subject, vars),
      html,
      text: template.text_content ? renderTemplate(template.text_content, vars) : undefined,
    };
  });

  const results = await provider.sendBatch(emails);
  const resultByEmail = new Map(results.map((r) => [r.to.toLowerCase(), r]));

  let totalSent = 0;
  let totalFailed = 0;
  for (const row of logRows ?? []) {
    const result = resultByEmail.get((row.recipient_email as string).toLowerCase());
    if (result?.success) {
      totalSent += 1;
      await admin.from('email_logs').update({ status: 'sent', provider: sender.provider, provider_message_id: result.messageId ?? null }).eq('id', row.id);
    } else {
      totalFailed += 1;
      await admin.from('email_logs').update({ status: 'failed', provider: sender.provider, error: result?.error ?? 'No result returned' }).eq('id', row.id);
    }
  }

  const finalStatus = totalSent > 0 ? 'sent' : 'failed';
  await admin
    .from('email_campaigns')
    .update({
      status: finalStatus,
      total_recipients: allowed.length + suppressed.length,
      total_sent: totalSent,
      total_failed: totalFailed,
      sent_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  if (totalSent > 0) {
    await admin.rpc('increment_template_sent_count', { p_template_id: campaign.template_id, p_amount: totalSent }).then(() => {}, () => {});
  }

  await logMailerAudit({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: 'campaign.send',
    targetType: 'campaign',
    targetId: campaignId,
    metadata: { total_sent: totalSent, total_failed: totalFailed, total_suppressed: suppressed.length, provider: sender.provider },
  });

  return { ok: true, totalRecipients: allowed.length + suppressed.length, totalSent, totalFailed, totalSuppressed: suppressed.length };
}
