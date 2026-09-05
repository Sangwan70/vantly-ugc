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

const VALID_KEYS = new Set(['welcome', 'no_subscription_nudge']);

/** Updates one fixed trigger's config -- rows are seeded by migration and never created/deleted here. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!VALID_KEYS.has(key)) return NextResponse.json({ error: 'Unknown trigger key' }, { status: 404 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updateRow: Record<string, unknown> = { updated_by: user.id };
  if (typeof body.enabled === 'boolean') updateRow.enabled = body.enabled;
  if (body.template_id === null || typeof body.template_id === 'string') updateRow.template_id = body.template_id || null;
  if (typeof body.delay_hours === 'number' && Number.isFinite(body.delay_hours) && body.delay_hours >= 0) {
    updateRow.delay_hours = Math.round(body.delay_hours);
  }

  if (updateRow.enabled === true) {
    const admin = adminClient();
    const { data: existing } = await admin.from('email_automated_triggers').select('template_id').eq('trigger_key', key).maybeSingle();
    const willHaveTemplate = updateRow.template_id !== undefined ? updateRow.template_id : existing?.template_id;
    if (!willHaveTemplate) {
      return NextResponse.json({ error: 'Select a template before enabling this trigger' }, { status: 400 });
    }
  }

  const { data, error } = await adminClient()
    .from('email_automated_triggers')
    .update(updateRow)
    .eq('trigger_key', key)
    .select('*, email_templates(name)')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update trigger', details: error.message }, { status: 500 });

  await logMailerAudit({ actorId: user.id, actorEmail: user.email, action: 'automated_trigger.update', targetType: 'automated_trigger', targetId: key, metadata: { enabled: data.enabled, delay_hours: data.delay_hours } });

  return NextResponse.json({ success: true, trigger: data });
}
