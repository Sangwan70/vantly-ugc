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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: landingPages, error } = await adminClient()
    .from('email_landing_pages')
    .select('*, email_groups(name, type)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to list landing pages', details: error.message }, { status: 500 });
  return NextResponse.json({ landing_pages: landingPages });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const targetGroupId = typeof body?.target_group_id === 'string' ? body.target_group_id : '';
  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug is required and must be lowercase letters/numbers/hyphens' }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  if (!targetGroupId) return NextResponse.json({ error: 'target_group_id is required' }, { status: 400 });

  const admin = adminClient();
  const { data: group, error: groupError } = await admin.from('email_groups').select('type').eq('id', targetGroupId).maybeSingle();
  if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
  if (!group) return NextResponse.json({ error: 'Target group not found' }, { status: 404 });
  if (group.type !== 'manual') {
    return NextResponse.json({ error: 'Only manual groups can be a landing page target (submissions are added as members)' }, { status: 400 });
  }

  const insertRow = {
    slug,
    title,
    description: typeof body?.description === 'string' ? body.description.trim() : '',
    target_group_id: targetGroupId,
    success_message: typeof body?.success_message === 'string' && body.success_message.trim() ? body.success_message.trim() : "Thanks -- you're subscribed.",
    redirect_url: typeof body?.redirect_url === 'string' && body.redirect_url.trim() ? body.redirect_url.trim() : null,
    created_by: user.id,
  };

  const { data: created, error } = await admin.from('email_landing_pages').insert(insertRow).select('*, email_groups(name, type)').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That slug is already in use' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to create landing page', details: error.message }, { status: 500 });
  }

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'landing_page.create', targetType: 'landing_page', targetId: created.id, metadata: { slug } });

  return NextResponse.json({ success: true, landing_page: created });
}
