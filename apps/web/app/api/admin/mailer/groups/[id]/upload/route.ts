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

const MAX_UPLOAD_EMAILS = 20_000;

/**
 * Merge a batch of emails into a manual group's members list.
 *
 * Body: { emails: string[] } OR { text: string } (newline/comma-separated
 * plaintext or a one-column CSV -- treated identically, split on any of
 * \n, \r, or , and trimmed). Invalid-looking addresses are silently
 * dropped rather than rejecting the whole upload; the response reports
 * how many were added vs. skipped so the admin can see what happened.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  let candidates: string[] = [];
  if (Array.isArray(body?.emails)) {
    candidates = body.emails.filter((e: unknown): e is string => typeof e === 'string');
  } else if (typeof body?.text === 'string') {
    candidates = body.text.split(/[\n\r,]+/);
  } else {
    return NextResponse.json({ error: 'Provide either { emails: string[] } or { text: string }' }, { status: 400 });
  }

  const admin = adminClient();
  const { data: group, error: fetchError } = await admin.from('email_groups').select('type, members').eq('id', id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  if (group.type !== 'manual') {
    return NextResponse.json({ error: 'Only manual groups accept an email upload' }, { status: 400 });
  }

  const cleaned = candidates.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
  const valid = cleaned.filter((e) => isValidEmail(e));
  const skipped = cleaned.length - valid.length;

  const merged = Array.from(new Set([...(group.members ?? []), ...valid]));
  if (merged.length > MAX_UPLOAD_EMAILS) {
    return NextResponse.json({ error: `Group would exceed the ${MAX_UPLOAD_EMAILS.toLocaleString()}-recipient cap` }, { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from('email_groups')
    .update({ members: merged, member_count: merged.length })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) return NextResponse.json({ error: 'Failed to save uploaded emails', details: updateError.message }, { status: 500 });
  return NextResponse.json({ success: true, group: updated, added: merged.length - (group.members?.length ?? 0), skipped });
}
