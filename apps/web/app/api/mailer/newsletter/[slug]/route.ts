// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /api/mailer/newsletter/[slug] -- public opt-in submission for an
 * email_landing_pages row. No auth (this is meant to be embedded/linked
 * from anywhere), so this uses the service-role client like the other
 * public Mailer routes (track/open, track/click, unsubscribe) -- RLS on
 * email_landing_pages and email_groups is service-role-only, matching
 * that same pattern (see 20260905130000_mailer_full_system.sql).
 *
 * Submitting is treated as fresh, explicit consent: the email is added to
 * the landing page's target manual group AND removed from
 * email_suppressions if it was previously unsubscribed/suppressed --
 * otherwise a resubscribe would silently never receive anything again,
 * which isn't what "sign up again" should mean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isValidEmail } from '@/lib/mailer/render-template';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const MAX_GROUP_MEMBERS = 20_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  const admin = adminClient();
  const { data: page, error: pageError } = await admin
    .from('email_landing_pages')
    .select('id, status, target_group_id, success_message, redirect_url')
    .eq('slug', slug)
    .maybeSingle();
  if (pageError) return NextResponse.json({ error: pageError.message }, { status: 500 });
  if (!page) return NextResponse.json({ error: 'This signup page does not exist' }, { status: 404 });
  if (page.status !== 'active') return NextResponse.json({ error: 'This signup page is no longer accepting submissions' }, { status: 410 });

  const { data: group, error: groupError } = await admin.from('email_groups').select('members').eq('id', page.target_group_id).maybeSingle();
  if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
  if (!group) return NextResponse.json({ error: 'This signup page is misconfigured (target group missing)' }, { status: 500 });

  const members: string[] = group.members ?? [];
  if (!members.includes(email)) {
    if (members.length >= MAX_GROUP_MEMBERS) {
      return NextResponse.json({ error: 'This list is full -- please try again later' }, { status: 503 });
    }
    const merged = [...members, email];
    const { error: updateError } = await admin.from('email_groups').update({ members: merged, member_count: merged.length }).eq('id', page.target_group_id);
    if (updateError) return NextResponse.json({ error: 'Failed to save your signup' }, { status: 500 });
  }

  // Explicit new consent supersedes a prior suppression -- see doc comment above.
  await admin.from('email_suppressions').delete().eq('email', email).then(() => {}, () => {});

  await admin.rpc('increment_landing_page_submit_count', { p_landing_page_id: page.id }).then(() => {}, async () => {
    // Fallback if the RPC isn't present for any reason -- non-atomic but best-effort, submit_count is a display metric only.
    const { data: current } = await admin.from('email_landing_pages').select('submit_count').eq('id', page.id).maybeSingle();
    await admin.from('email_landing_pages').update({ submit_count: (current?.submit_count ?? 0) + 1 }).eq('id', page.id);
  });

  return NextResponse.json({ success: true, message: page.success_message, redirect_url: page.redirect_url });
}
