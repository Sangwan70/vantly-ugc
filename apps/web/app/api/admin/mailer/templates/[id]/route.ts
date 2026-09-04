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

const EDITABLE_FIELDS = ['name', 'subject', 'html_content', 'text_content', 'variables', 'status'] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient().from('email_templates').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updateRow: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) updateRow[field] = body[field];
  }
  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from('email_templates')
    .update(updateRow)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to update template', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, template: data });
}

/**
 * Hard-deletes the template. A template referenced by any email_campaigns
 * row can't be deleted -- the FK (no ON DELETE action) rejects it with
 * Postgres error 23503, surfaced here as a friendly message pointing at
 * archiving instead (PUT { status: 'archived' }).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error } = await adminClient().from('email_templates').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'This template is used by one or more campaigns -- archive it instead of deleting.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to delete template', details: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
