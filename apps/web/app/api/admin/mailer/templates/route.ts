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

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: templates, error } = await adminClient()
    .from('email_templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to list templates', details: error.message }, { status: 500 });
  }
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const htmlContent = typeof body.html_content === 'string' ? body.html_content : '';
  if (!name || !subject || !htmlContent) {
    return NextResponse.json({ error: 'name, subject, and html_content are required' }, { status: 400 });
  }

  const insertRow = {
    name,
    subject,
    html_content: htmlContent,
    text_content: typeof body.text_content === 'string' ? body.text_content.trim() || null : null,
    variables: Array.isArray(body.variables) ? body.variables.filter((v: unknown) => typeof v === 'string') : [],
    status: body.status === 'archived' ? 'archived' : 'active',
    created_by: user.id,
  };

  const { data: created, error } = await adminClient()
    .from('email_templates')
    .insert(insertRow)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to create template', details: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, template: created });
}
