// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /api/admin/settings/mailer/test — sends a real test email through
 * whatever sender config is CURRENTLY SAVED (DB row, falling back to env),
 * so the test actually exercises what production sends with. Body:
 * { test_email: string }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { getEffectiveSenderConfig } from '@/lib/mailer/sender-config';

interface Body {
  test_email?: unknown;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const testEmail = typeof body.test_email === 'string' ? body.test_email.trim() : '';
  if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return NextResponse.json({ error: 'test_email must be a valid email address' }, { status: 400 });
  }

  const sender = await getEffectiveSenderConfig();
  if (!sender.apiKey) {
    return NextResponse.json({ error: 'No Resend API key configured (neither in Settings → Mailer nor RESEND_API_KEY)' }, { status: 503 });
  }

  const resend = new Resend(sender.apiKey);
  try {
    const { error } = await resend.emails.send({
      from: sender.from,
      to: testEmail,
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      subject: 'Vantly UGC — test email',
      text: [
        'This is a test email from Vantly UGC admin settings.',
        '',
        `Sent from: ${sender.from}`,
        sender.replyTo ? `Reply-to: ${sender.replyTo}` : null,
        `API key source: ${sender.apiKeyFromDb ? 'Settings → Mailer' : 'RESEND_API_KEY env var'}`,
        `Sent by: ${user.email}`,
      ].filter(Boolean).join('\n'),
    });
    if (error) {
      return NextResponse.json({ error: error.message ?? 'Email send failed' }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Email send failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
