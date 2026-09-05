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

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) return null;
  return user;
}

const SELECT_COLUMNS =
  'from_name, from_email, reply_to_email, logo_url, footer_text, resend_api_key, provider, ' +
  'postmark_api_key, ses_access_key_id, ses_secret_access_key, ses_region, ' +
  'smtp_host, smtp_port, smtp_username, smtp_password, smtp_secure, updated_at';

interface MailerConfigDbRow {
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  logo_url: string | null;
  footer_text: string | null;
  resend_api_key: string | null;
  provider: string;
  postmark_api_key: string | null;
  ses_access_key_id: string | null;
  ses_secret_access_key: string | null;
  ses_region: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  smtp_secure: boolean;
  updated_at: string;
}

/**
 * Secret fields (resend_api_key, postmark_api_key, ses_secret_access_key,
 * smtp_password) never round-trip to the browser -- GET returns only a
 * `*_set` boolean plus a source ('database' | 'env' | 'none', for the two
 * that have an env-var fallback) per field. PUT only touches a stored
 * secret when a non-empty value is explicitly submitted for it, or clears
 * it when the matching `clear_*` flag is true -- every other field is
 * always safe to display/re-submit (an AWS access key id and an SMTP
 * username/host/port aren't secrets by themselves).
 */
function toSettingsResponse(data: MailerConfigDbRow) {
  const hasDbResendKey = !!data.resend_api_key?.trim();
  const hasEnvResendKey = !!process.env.RESEND_API_KEY;
  return {
    from_name: data.from_name,
    from_email: data.from_email,
    reply_to_email: data.reply_to_email,
    logo_url: data.logo_url,
    footer_text: data.footer_text,
    updated_at: data.updated_at,
    provider: data.provider,
    resend_api_key_set: hasDbResendKey,
    resend_api_key_source: hasDbResendKey ? 'database' : hasEnvResendKey ? 'env' : 'none',
    postmark_api_key_set: !!data.postmark_api_key?.trim(),
    ses_access_key_id: data.ses_access_key_id,
    ses_secret_access_key_set: !!data.ses_secret_access_key?.trim(),
    ses_region: data.ses_region,
    smtp_host: data.smtp_host,
    smtp_port: data.smtp_port,
    smtp_username: data.smtp_username,
    smtp_password_set: !!data.smtp_password?.trim(),
    smtp_secure: data.smtp_secure,
  };
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient().from('mailer_config').select(SELECT_COLUMNS).eq('id', 'default').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A pre-migration row (or no row at all) still needs sane defaults so
  // the settings form has something to render.
  const row: MailerConfigDbRow = {
    from_name: null, from_email: null, reply_to_email: null, logo_url: null, footer_text: null, resend_api_key: null,
    provider: 'resend', postmark_api_key: null, ses_access_key_id: null, ses_secret_access_key: null, ses_region: null,
    smtp_host: null, smtp_port: null, smtp_username: null, smtp_password: null, smtp_secure: true,
    updated_at: new Date(0).toISOString(),
    ...(data as Partial<MailerConfigDbRow> | null ?? {}),
  };

  return NextResponse.json({ settings: toSettingsResponse(row) });
}

interface Body {
  from_name?: unknown;
  from_email?: unknown;
  reply_to_email?: unknown;
  logo_url?: unknown;
  footer_text?: unknown;
  provider?: unknown;
  resend_api_key?: unknown;
  clear_resend_api_key?: unknown;
  postmark_api_key?: unknown;
  clear_postmark_api_key?: unknown;
  ses_access_key_id?: unknown;
  ses_secret_access_key?: unknown;
  clear_ses_secret_access_key?: unknown;
  ses_region?: unknown;
  smtp_host?: unknown;
  smtp_port?: unknown;
  smtp_username?: unknown;
  smtp_password?: unknown;
  clear_smtp_password?: unknown;
  smtp_secure?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

const VALID_PROVIDERS = new Set(['resend', 'postmark', 'ses', 'smtp']);

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fromEmail = str(body.from_email);
  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    return NextResponse.json({ error: 'from_email is not a valid email address' }, { status: 400 });
  }
  const replyTo = str(body.reply_to_email);
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    return NextResponse.json({ error: 'reply_to_email is not a valid email address' }, { status: 400 });
  }
  const provider = typeof body.provider === 'string' ? body.provider : undefined;
  if (provider !== undefined && !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `provider must be one of: ${Array.from(VALID_PROVIDERS).join(', ')}` }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    id: 'default',
    from_name: str(body.from_name),
    from_email: fromEmail,
    reply_to_email: replyTo,
    logo_url: str(body.logo_url),
    footer_text: str(body.footer_text),
    ses_access_key_id: str(body.ses_access_key_id),
    ses_region: str(body.ses_region),
    smtp_host: str(body.smtp_host),
    smtp_username: str(body.smtp_username),
    updated_by: user.id,
  };
  if (provider !== undefined) patch.provider = provider;
  if (typeof body.smtp_port === 'number' && Number.isFinite(body.smtp_port)) patch.smtp_port = Math.round(body.smtp_port);
  if (typeof body.smtp_secure === 'boolean') patch.smtp_secure = body.smtp_secure;

  // Each secret: only touch when a non-empty value is submitted, or clear
  // when explicitly asked to -- otherwise leave the stored value alone.
  const secretFields: [string, unknown, unknown][] = [
    ['resend_api_key', body.resend_api_key, body.clear_resend_api_key],
    ['postmark_api_key', body.postmark_api_key, body.clear_postmark_api_key],
    ['ses_secret_access_key', body.ses_secret_access_key, body.clear_ses_secret_access_key],
    ['smtp_password', body.smtp_password, body.clear_smtp_password],
  ];
  for (const [field, value, clearFlag] of secretFields) {
    const s = str(value);
    if (s) patch[field] = s;
    else if (clearFlag === true) patch[field] = null;
  }

  const { data, error } = await adminClient().from('mailer_config').upsert(patch, { onConflict: 'id' }).select(SELECT_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as unknown as MailerConfigDbRow;

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'sender.update', targetType: 'sender_config', metadata: { provider: row.provider } });

  return NextResponse.json({ settings: toSettingsResponse(row) });
}
