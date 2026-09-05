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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient().from('email_landing_pages').select('*, email_groups(name, type)').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
  return NextResponse.json({ landing_page: data });
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
  if (typeof body.slug === 'string' && body.slug.trim()) {
    const slug = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'slug must be lowercase letters/numbers/hyphens' }, { status: 400 });
    updateRow.slug = slug;
  }
  if (typeof body.title === 'string' && body.title.trim()) updateRow.title = body.title.trim();
  if (typeof body.description === 'string') updateRow.description = body.description.trim();
  if (typeof body.success_message === 'string' && body.success_message.trim()) updateRow.success_message = body.success_message.trim();
  if (body.redirect_url === null || typeof body.redirect_url === 'string') updateRow.redirect_url = body.redirect_url?.trim() || null;
  if (body.status === 'active' || body.status === 'disabled') updateRow.status = body.status;
  if (typeof body.target_group_id === 'string' && body.target_group_id) {
    const admin = adminClient();
    const { data: group, error: groupError } = await admin.from('email_groups').select('type').eq('id', body.target_group_id).maybeSingle();
    if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
    if (!group) return NextResponse.json({ error: 'Target group not found' }, { status: 404 });
    if (group.type !== 'manual') return NextResponse.json({ error: 'Only manual groups can be a landing page target' }, { status: 400 });
    updateRow.target_group_id = body.target_group_id;
  }
  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const { data, error } = await adminClient().from('email_landing_pages').update(updateRow).eq('id', id).select('*, email_groups(name, type)').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That slug is already in use' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to update landing page', details: error.message }, { status: 500 });
  }

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'landing_page.update', targetType: 'landing_page', targetId: id });

  return NextResponse.json({ success: true, landing_page: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error } = await adminClient().from('email_landing_pages').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete landing page', details: error.message }, { status: 500 });

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'landing_page.delete', targetType: 'landing_page', targetId: id });

  return NextResponse.json({ success: true });
}
