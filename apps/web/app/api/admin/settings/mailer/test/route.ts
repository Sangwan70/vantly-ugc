// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /api/admin/settings/mailer/test — sends a real test email through
 * whatever sender config is CURRENTLY SAVED (DB row, falling back to env),
 * so the test actually exercises what production sends with. Body:
 * { test_email: string }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { getEffectiveSenderConfig } from '@/lib/mailer/sender-config';
import { getProviderSender } from '@/lib/mailer/providers';
import { logMailerAudit } from '@/lib/mailer/audit-log';

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
  if (!sender.configured) {
    return NextResponse.json(
      { error: `${sender.provider} is selected in Settings → Mailer but isn't fully configured yet.` },
      { status: 503 },
    );
  }

  let provider;
  try {
    provider = getProviderSender(sender);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Mailer provider is misconfigured' }, { status: 503 });
  }

  const [result] = await provider.sendBatch([
    {
      from: sender.from,
      to: testEmail,
      replyTo: sender.replyTo,
      subject: 'Vantly UGC — test email',
      html: [
        '<p>This is a test email from Vantly UGC admin settings.</p>',
        `<p>Provider: ${sender.provider}<br>Sent from: ${sender.from}${sender.replyTo ? `<br>Reply-to: ${sender.replyTo}` : ''}<br>Credential source: ${sender.credentialFromDb ? 'Settings → Mailer' : 'environment variable'}<br>Sent by: ${user.email}</p>`,
      ].join('\n'),
      text: [
        'This is a test email from Vantly UGC admin settings.',
        '',
        `Provider: ${sender.provider}`,
        `Sent from: ${sender.from}`,
        sender.replyTo ? `Reply-to: ${sender.replyTo}` : null,
        `Credential source: ${sender.credentialFromDb ? 'Settings → Mailer' : 'environment variable'}`,
        `Sent by: ${user.email}`,
      ].filter(Boolean).join('\n'),
    },
  ]);

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'sender.test_send', targetType: 'sender_config', metadata: { provider: sender.provider, success: result.success } });

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Email send failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
