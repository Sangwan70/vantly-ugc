// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** The two fixed lifecycle triggers -- see 20260905130000_mailer_full_system.sql's CHECK constraint. Row-per-trigger config only; actual dispatch is lib/mailer/automated-triggers.ts, cron-driven. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await adminClient()
    .from('email_automated_triggers')
    .select('*, email_templates(name)')
    .order('trigger_key', { ascending: true });

  if (error) return NextResponse.json({ error: 'Failed to list automated triggers', details: error.message }, { status: 500 });
  return NextResponse.json({ triggers: data });
}
