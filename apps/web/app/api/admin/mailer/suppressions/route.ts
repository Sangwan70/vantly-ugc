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

/** Lists the suppression list -- an admin needs to see who's on it (and why) even though nothing sends to them. */
export async function GET(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  let query = adminClient().from('email_suppressions').select('*').order('created_at', { ascending: false }).limit(500);
  if (q) query = query.ilike('email', `%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppressions: data ?? [] });
}

/** Manually suppress an address -- e.g. a spam complaint reported outside any provider webhook, or an operator honoring an out-of-band request. */
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  const { error } = await adminClient().rpc('add_email_suppression', { p_email: email, p_reason: 'manual', p_campaign_id: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'suppression.add', targetType: 'suppression', targetId: email, metadata: { reason: 'manual' } });
  return NextResponse.json({ success: true });
}
