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

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) return null;
  return user;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient()
    .from('email_campaigns')
    .select('*, email_templates(name, subject), email_groups(name, type, member_count)')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  return NextResponse.json({ campaign: data });
}

/** Edits are only meaningful while status='draft' -- a sent/sending campaign's record is a fixed history entry. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data: existing, error: fetchError } = await adminClient().from('email_campaigns').select('status').eq('id', id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: `Cannot edit a campaign with status '${existing.status}'` }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updateRow: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) updateRow.name = body.name.trim();
  if (typeof body.template_id === 'string' && body.template_id) updateRow.template_id = body.template_id;
  if (body.group_id === null || typeof body.group_id === 'string') updateRow.group_id = body.group_id || null;
  if (Array.isArray(body.recipient_emails)) {
    updateRow.recipient_emails = Array.from(new Set(
      body.recipient_emails.filter((e: unknown): e is string => typeof e === 'string' && isValidEmail(e.trim())).map((e: string) => e.trim().toLowerCase()),
    ));
  }
  if (body.template_vars && typeof body.template_vars === 'object') updateRow.template_vars = body.template_vars;

  const { data, error } = await adminClient().from('email_campaigns').update(updateRow).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: 'Failed to update campaign', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, campaign: data });
}

/** Only a draft can be deleted -- a sent campaign is kept as a record. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data: existing, error: fetchError } = await adminClient().from('email_campaigns').select('status').eq('id', id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: `Cannot delete a campaign with status '${existing.status}' -- it's kept as a send record` }, { status: 409 });
  }

  const { error } = await adminClient().from('email_campaigns').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete campaign', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
