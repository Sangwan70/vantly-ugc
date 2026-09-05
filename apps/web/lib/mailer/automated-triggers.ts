// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Evaluates the two fixed lifecycle triggers (email_automated_triggers --
 * 'welcome', 'no_subscription_nudge') and sends whatever's newly eligible.
 * Called by app/api/internal/mailer/dispatch/route.ts, itself only
 * reachable by the mailer-automation-runner cron tick (shared-secret
 * gated, see that route's own doc comment) -- there's no admin-facing
 * "send now" for these, they're purely time-based.
 *
 * Each user gets each trigger AT MOST ONCE, enforced by
 * email_automated_sends' UNIQUE(user_id, trigger_key) constraint (belt),
 * checked here too before sending (suspenders) to avoid burning a
 * provider call that would just fail the insert anyway.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveSenderConfig } from './sender-config';
import { getProviderSender } from './providers';
import { renderTemplate } from './render-template';
import { filterSuppressed } from './resolve-recipients';
import { finalizeOutboundHtml } from './tracking';

const LIST_USERS_PAGE_SIZE = 1000;
// Don't keep re-scanning accounts forever -- once a user is more than 30
// days past a trigger's delay, treat it as no longer eligible (they
// either already got it, or the operator only just enabled this trigger
// after they signed up, which shouldn't suddenly email a long-time user
// out of the blue).
const MAX_ELIGIBILITY_WINDOW_HOURS = 30 * 24;

interface EligibleUser {
  id: string;
  email: string;
}

async function listSignupEligibleUsers(
  admin: SupabaseClient,
  delayHours: number,
  extraFilter: (userId: string) => boolean,
): Promise<EligibleUser[]> {
  const out: EligibleUser[] = [];
  const now = Date.now();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_USERS_PAGE_SIZE });
    if (error) throw new Error(`Failed to list users for automated triggers: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email || !u.created_at) continue;
      const ageHours = (now - new Date(u.created_at).getTime()) / (60 * 60 * 1000);
      if (ageHours < delayHours) continue;
      if (ageHours > delayHours + MAX_ELIGIBILITY_WINDOW_HOURS) continue;
      if (!extraFilter(u.id)) continue;
      out.push({ id: u.id, email: u.email });
    }
    if (users.length < LIST_USERS_PAGE_SIZE) break;
    page += 1;
  }
  return out;
}

export interface DispatchTriggersResult {
  sent: number;
  failed: number;
  skippedSuppressed: number;
  errors: string[];
}

export async function dispatchAutomatedTriggers(admin: SupabaseClient): Promise<DispatchTriggersResult> {
  const result: DispatchTriggersResult = { sent: 0, failed: 0, skippedSuppressed: 0, errors: [] };

  const { data: triggers, error: triggersError } = await admin
    .from('email_automated_triggers')
    .select('trigger_key, enabled, template_id, delay_hours')
    .eq('enabled', true);
  if (triggersError) {
    result.errors.push(`Failed to load automated triggers: ${triggersError.message}`);
    return result;
  }
  if (!triggers || triggers.length === 0) return result;

  const sender = await getEffectiveSenderConfig();
  if (!sender.configured) {
    result.errors.push(`Automated triggers are enabled but ${sender.provider} isn't fully configured`);
    return result;
  }
  let provider;
  try {
    provider = getProviderSender(sender);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : 'Mailer provider is misconfigured');
    return result;
  }

  // Every user already subscribed (active/trialing) is exempt from the
  // no_subscription_nudge trigger -- loaded once, reused for that
  // trigger's eligibility filter below.
  const { data: activeSubs } = await admin.from('subscriptions').select('user_id, status');
  const activeSubUserIds = new Set((activeSubs ?? []).filter((s) => s.status === 'active' || s.status === 'trialing').map((s) => s.user_id as string));

  for (const trigger of triggers) {
    if (!trigger.template_id) {
      result.errors.push(`Trigger "${trigger.trigger_key}" is enabled but has no template selected`);
      continue;
    }
    const { data: template } = await admin
      .from('email_templates')
      .select('subject, html_content, text_content')
      .eq('id', trigger.template_id)
      .maybeSingle();
    if (!template) {
      result.errors.push(`Trigger "${trigger.trigger_key}"'s template no longer exists`);
      continue;
    }

    let eligible: EligibleUser[];
    try {
      eligible = await listSignupEligibleUsers(admin, trigger.delay_hours, (userId) =>
        trigger.trigger_key === 'no_subscription_nudge' ? !activeSubUserIds.has(userId) : true,
      );
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : `Failed to evaluate eligibility for "${trigger.trigger_key}"`);
      continue;
    }
    if (eligible.length === 0) continue;

    // Already-sent check (the "suspenders" half of the belt-and-suspenders
    // described above).
    const { data: alreadySent } = await admin
      .from('email_automated_sends')
      .select('user_id')
      .eq('trigger_key', trigger.trigger_key)
      .in('user_id', eligible.map((u) => u.id));
    const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.user_id as string));
    const pending = eligible.filter((u) => !alreadySentIds.has(u.id));
    if (pending.length === 0) continue;

    const { allowed, suppressed } = await filterSuppressed(admin, pending.map((u) => u.email));
    result.skippedSuppressed += suppressed.length;
    const allowedSet = new Set(allowed.map((e) => e.toLowerCase()));
    const toSend = pending.filter((u) => allowedSet.has(u.email.toLowerCase()));
    if (toSend.length === 0) continue;

    for (const u of toSend) {
      const vars = { email: u.email };
      // A synthetic per-send tracking token (not backed by an email_logs
      // row, since automated triggers aren't campaigns) -- still lets the
      // unsubscribe link and pixel work identically; open/click counts
      // for these sends just aren't queryable per-recipient the way
      // campaign sends are.
      const token = `trig_${trigger.trigger_key}_${u.id}`;
      const html = finalizeOutboundHtml(renderTemplate(template.html_content, vars), token, u.email, { logoUrl: sender.logoUrl, footerText: sender.footerText });
      const [sendResult] = await provider.sendBatch([
        {
          to: u.email,
          from: sender.from,
          replyTo: sender.replyTo,
          subject: renderTemplate(template.subject, vars),
          html,
          text: template.text_content ? renderTemplate(template.text_content, vars) : undefined,
        },
      ]);
      if (sendResult.success) {
        result.sent += 1;
        await admin.from('email_automated_sends').insert({ user_id: u.id, trigger_key: trigger.trigger_key }).then(() => {}, () => {});
      } else {
        result.failed += 1;
        result.errors.push(`${trigger.trigger_key} -> ${u.email}: ${sendResult.error ?? 'send failed'}`);
      }
    }
  }

  return result;
}
