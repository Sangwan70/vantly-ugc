// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Resolves the effective transactional-email sender identity, merging the
 * admin-configurable mailer_config row (Settings → Mailer) over env-var
 * defaults. Lets an admin set/override the sender without a redeploy, while
 * a fresh install with no DB row keeps working off env vars alone — same
 * "DB overrides env" shape as site_settings/currencies.
 *
 * Server-only. Never import into a 'use client' component — this reads the
 * service-role key.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

export interface MailerConfigRow {
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  resend_api_key: string | null;
}

export interface EffectiveSenderConfig {
  apiKey: string | null;
  /** Resend `from` string, e.g. "Vantly UGC <hello@vantly-ugc.com>". */
  from: string;
  replyTo: string | null;
  /** True when the DB row supplied the API key (vs. falling back to env). */
  apiKeyFromDb: boolean;
}

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Raw mailer_config row, or null if the table/row doesn't exist yet (pre-migration). */
export async function getMailerConfigRow(): Promise<MailerConfigRow | null> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('mailer_config')
    .select('from_name, from_email, reply_to_email, resend_api_key')
    .eq('id', 'default')
    .maybeSingle();
  if (error || !data) return null;
  return data as MailerConfigRow;
}

/** Merge the DB row (if any) over env-var defaults into what a send actually needs. */
export async function getEffectiveSenderConfig(): Promise<EffectiveSenderConfig> {
  const row = await getMailerConfigRow();

  const envFrom = process.env.SUPPORT_FROM ?? 'Vantly UGC <hello@vantly-ugc.com>';
  const fromName = row?.from_name?.trim() || null;
  const fromEmail = row?.from_email?.trim() || null;
  const from = fromName && fromEmail ? `${fromName} <${fromEmail}>` : (fromEmail || envFrom);

  const apiKeyFromDb = !!row?.resend_api_key?.trim();
  const apiKey = (row?.resend_api_key?.trim() || process.env.RESEND_API_KEY) ?? null;

  return {
    apiKey,
    from,
    replyTo: row?.reply_to_email?.trim() || null,
    apiKeyFromDb,
  };
}
