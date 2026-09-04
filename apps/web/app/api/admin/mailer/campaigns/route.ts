// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { isValidEmail } from '@/lib/mailer/render-template';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: campaigns, error } = await adminClient()
    .from('email_campaigns')
    .select('*, email_templates(name), email_groups(name)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to list campaigns', details: error.message }, { status: 500 });
  return NextResponse.json({ campaigns });
}

/** Creates a draft only -- sending is a separate POST .../[id]/send call, never implicit in create. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const templateId = typeof body?.template_id === 'string' ? body.template_id : '';
  if (!name || !templateId) {
    return NextResponse.json({ error: 'name and template_id are required' }, { status: 400 });
  }

  const recipientEmails: string[] = Array.isArray(body?.recipient_emails)
    ? Array.from(new Set(body.recipient_emails.filter((e: unknown): e is string => typeof e === 'string' && isValidEmail(e.trim())).map((e: string) => e.trim().toLowerCase())))
    : [];

  const insertRow = {
    name,
    template_id: templateId,
    group_id: typeof body?.group_id === 'string' && body.group_id ? body.group_id : null,
    recipient_emails: recipientEmails,
    template_vars: body?.template_vars && typeof body.template_vars === 'object' ? body.template_vars : {},
    created_by: user.id,
  };

  const { data: created, error } = await adminClient()
    .from('email_campaigns')
    .insert(insertRow)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to create campaign', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, campaign: created });
}
