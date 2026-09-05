// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { resolveSmartGroupRecipients, type SmartRules } from '@/lib/mailer/resolve-recipients';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Live preview for the smart-group rule builder -- evaluates the given
 * (not-yet-saved) rules against real user/subscription data and returns a
 * count + a small sample, so an admin can sanity-check a segment before
 * saving it. Never persists anything.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rules = body?.smart_rules as SmartRules | undefined;
  if (!rules || !Array.isArray(rules.conditions) || rules.conditions.length === 0) {
    return NextResponse.json({ error: 'smart_rules with at least one condition is required' }, { status: 400 });
  }

  try {
    const emails = await resolveSmartGroupRecipients(adminClient(), rules);
    return NextResponse.json({ count: emails.length, sample: emails.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
