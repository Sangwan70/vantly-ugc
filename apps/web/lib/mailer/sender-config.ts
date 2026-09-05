// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Resolves the effective transactional-email sender identity AND which
 * provider/credentials to send through, merging the admin-configurable
 * mailer_config row (Settings -> Mailer) over env-var defaults. Lets an
 * admin set/override the sender without a redeploy, while a fresh install
 * with no DB row keeps working off env vars alone -- same "DB overrides
 * env" shape as site_settings/currencies.
 *
 * Multi-provider (20260905130000_mailer_full_system.sql): `provider`
 * selects which credential set actually gets used; the other providers'
 * fields stay stored but unused, so switching providers and back doesn't
 * lose configuration. Only Resend/Postmark/SES are implemented for
 * sending -- see lib/mailer/providers/types.ts's doc comment for why SMTP
 * isn't (no client library, and this pnpm workspace's install is
 * currently blocked -- see lib/content/sanitize-html.ts's own note on the
 * same ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF blocker -- so adding a new
 * dependency like nodemailer wasn't done without Ram running that
 * deliberately).
 *
 * Server-only. Never import into a 'use client' component -- this reads the
 * service-role key.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

export type MailerProviderName = 'resend' | 'postmark' | 'ses' | 'smtp';

export interface MailerConfigRow {
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  logo_url: string | null;
  footer_text: string | null;
  resend_api_key: string | null;
  provider: MailerProviderName;
  postmark_api_key: string | null;
  ses_access_key_id: string | null;
  ses_secret_access_key: string | null;
  ses_region: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_secure: boolean;
}

export interface EffectiveSenderConfig {
  provider: MailerProviderName;
  /** Resend/Postmark/SES `from` string, e.g. "Vantly UGC <hello@vantly-ugc.com>". */
  from: string;
  replyTo: string | null;
  /** Branding shown on outbound campaign/automated-trigger emails -- see lib/mailer/tracking.ts. Null when unset (no logo header / no extra footer line). */
  logoUrl: string | null;
  footerText: string | null;
  resendApiKey: string | null;
  postmarkApiKey: string | null;
  sesAccessKeyId: string | null;
  sesSecretAccessKey: string | null;
  sesRegion: string | null;
  /** True when the DB row supplied a credential for the SELECTED provider (vs. env fallback / unconfigured). */
  credentialFromDb: boolean;
  /** Whether the selected provider actually has everything it needs to send right now. */
  configured: boolean;
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
    .select(
      'from_name, from_email, reply_to_email, logo_url, footer_text, resend_api_key, provider, postmark_api_key, ses_access_key_id, ses_secret_access_key, ses_region, smtp_host, smtp_port, smtp_username, smtp_password, smtp_secure',
    )
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
  const replyTo = row?.reply_to_email?.trim() || null;
  const logoUrl = row?.logo_url?.trim() || null;
  const footerText = row?.footer_text?.trim() || null;

  const provider: MailerProviderName = row?.provider ?? 'resend';

  const resendApiKey = (row?.resend_api_key?.trim() || process.env.RESEND_API_KEY) || null;
  const postmarkApiKey = row?.postmark_api_key?.trim() || null;
  const sesAccessKeyId = row?.ses_access_key_id?.trim() || null;
  const sesSecretAccessKey = row?.ses_secret_access_key?.trim() || null;
  const sesRegion = row?.ses_region?.trim() || null;

  let credentialFromDb = false;
  let configured = false;
  switch (provider) {
    case 'resend':
      credentialFromDb = !!row?.resend_api_key?.trim();
      configured = !!resendApiKey;
      break;
    case 'postmark':
      credentialFromDb = !!postmarkApiKey;
      configured = !!postmarkApiKey;
      break;
    case 'ses':
      credentialFromDb = !!(sesAccessKeyId && sesSecretAccessKey && sesRegion);
      configured = credentialFromDb;
      break;
    case 'smtp':
      credentialFromDb = false;
      configured = false; // never configured -- sending isn't implemented, see providers/types.ts
      break;
  }

  return {
    provider,
    from,
    replyTo,
    logoUrl,
    footerText,
    resendApiKey,
    postmarkApiKey,
    sesAccessKeyId,
    sesSecretAccessKey,
    sesRegion,
    credentialFromDb,
    configured,
  };
}
