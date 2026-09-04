// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { renderTemplate } from '@/lib/mailer/render-template';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Renders a template with sample/provided variables. Never sends anything. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const vars: Record<string, string> = {};
  if (body?.variables && typeof body.variables === 'object') {
    for (const [k, v] of Object.entries(body.variables)) {
      if (typeof v === 'string') vars[k] = v;
    }
  }

  const { data: template, error } = await adminClient()
    .from('email_templates')
    .select('subject, html_content, text_content, variables')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Fill in a visible placeholder for any documented variable the caller
  // didn't supply, so a preview never silently renders someone's real data.
  for (const key of template.variables ?? []) {
    if (!(key in vars)) vars[key] = `[${key}]`;
  }

  return NextResponse.json({
    subject: renderTemplate(template.subject, vars),
    html: renderTemplate(template.html_content, vars),
    text: template.text_content ? renderTemplate(template.text_content, vars) : null,
  });
}
