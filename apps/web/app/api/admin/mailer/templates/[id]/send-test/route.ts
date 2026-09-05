// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { getEffectiveSenderConfig } from '@/lib/mailer/sender-config';
import { getProviderSender } from '@/lib/mailer/providers';
import { renderTemplate, isValidEmail } from '@/lib/mailer/render-template';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Sends one real email via Resend to an admin-chosen address. Does not increment sent_count -- that's reserved for real campaign sends. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  if (!to || !isValidEmail(to)) {
    return NextResponse.json({ error: 'A valid "to" email address is required' }, { status: 400 });
  }
  const vars: Record<string, string> = {};
  if (body?.variables && typeof body.variables === 'object') {
    for (const [k, v] of Object.entries(body.variables)) {
      if (typeof v === 'string') vars[k] = v;
    }
  }

  const admin = adminClient();
  const { data: template, error } = await admin
    .from('email_templates')
    .select('subject, html_content, text_content, variables')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  for (const key of template.variables ?? []) {
    if (!(key in vars)) vars[key] = `[${key}]`;
  }

  const sender = await getEffectiveSenderConfig();
  if (!sender.configured) {
    return NextResponse.json(
      { error: `${sender.provider} is selected in Settings -> Mailer but isn't fully configured yet.` },
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
      to,
      replyTo: sender.replyTo,
      subject: `[TEST] ${renderTemplate(template.subject, vars)}`,
      html: renderTemplate(template.html_content, vars),
      text: template.text_content ? renderTemplate(template.text_content, vars) : undefined,
    },
  ]);

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
