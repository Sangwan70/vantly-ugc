// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

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

/**
 * GET/PUT never round-trip the actual resend_api_key value to the browser.
 * GET returns `resend_api_key_set` (whether a DB override is stored) plus
 * `resend_api_key_source: 'database' | 'env' | 'none'` so the admin can see
 * what's actually in effect; PUT only touches the stored key when a
 * non-empty `resend_api_key` is submitted, leaving it untouched otherwise —
 * so re-saving the form (e.g. after editing the from-name) never requires
 * re-entering the key, and there's nothing to redact/re-display.
 */
export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient()
    .from('mailer_config')
    .select('from_name, from_email, reply_to_email, logo_url, footer_text, resend_api_key, updated_at')
    .eq('id', 'default')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasDbKey = !!data?.resend_api_key?.trim();
  const hasEnvKey = !!process.env.RESEND_API_KEY;

  return NextResponse.json({
    settings: {
      from_name: data?.from_name ?? null,
      from_email: data?.from_email ?? null,
      reply_to_email: data?.reply_to_email ?? null,
      logo_url: data?.logo_url ?? null,
      footer_text: data?.footer_text ?? null,
      updated_at: data?.updated_at ?? null,
      resend_api_key_set: hasDbKey,
      resend_api_key_source: hasDbKey ? 'database' : hasEnvKey ? 'env' : 'none',
    },
  });
}

interface Body {
  from_name?: unknown;
  from_email?: unknown;
  reply_to_email?: unknown;
  logo_url?: unknown;
  footer_text?: unknown;
  resend_api_key?: unknown;
  clear_resend_api_key?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

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

  const patch: Record<string, unknown> = {
    id: 'default',
    from_name: str(body.from_name),
    from_email: fromEmail,
    reply_to_email: replyTo,
    logo_url: str(body.logo_url),
    footer_text: str(body.footer_text),
    updated_by: user.id,
  };
  // Only touch the stored key when explicitly asked to.
  const newKey = str(body.resend_api_key);
  if (newKey) patch.resend_api_key = newKey;
  else if (body.clear_resend_api_key === true) patch.resend_api_key = null;

  const { data, error } = await adminClient()
    .from('mailer_config')
    .upsert(patch, { onConflict: 'id' })
    .select('from_name, from_email, reply_to_email, logo_url, footer_text, resend_api_key, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const hasDbKey = !!data?.resend_api_key?.trim();
  const hasEnvKey = !!process.env.RESEND_API_KEY;
  return NextResponse.json({
    settings: {
      from_name: data.from_name, from_email: data.from_email, reply_to_email: data.reply_to_email,
      logo_url: data.logo_url, footer_text: data.footer_text,
      updated_at: data.updated_at,
      resend_api_key_set: hasDbKey,
      resend_api_key_source: hasDbKey ? 'database' : hasEnvKey ? 'env' : 'none',
    },
  });
}
