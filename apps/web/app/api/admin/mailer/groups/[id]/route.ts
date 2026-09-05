// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { isValidEmail } from '@/lib/mailer/render-template';
import type { SmartRules } from '@/lib/mailer/resolve-recipients';

function parseSmartRules(input: unknown): SmartRules | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const match = obj.match === 'any' ? 'any' : 'all';
  const conditions = Array.isArray(obj.conditions)
    ? obj.conditions
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          field: (['plan_slug', 'subscription_status', 'signup_days_ago'].includes(c.field as string) ? c.field : 'plan_slug') as SmartRules['conditions'][number]['field'],
          op: (['eq', 'ne', 'in', 'gte', 'lte'].includes(c.op as string) ? c.op : 'eq') as SmartRules['conditions'][number]['op'],
          value: (Array.isArray(c.value) ? c.value.map(String) : typeof c.value === 'number' ? c.value : String(c.value ?? '')) as SmartRules['conditions'][number]['value'],
        }))
    : [];
  return { match, conditions };
}

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

  const { data, error } = await adminClient().from('email_groups').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  return NextResponse.json({ group: data });
}

/** Rename, or (manual groups only) replace the full members list. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updateRow: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) updateRow.name = body.name.trim();
  if (Array.isArray(body.members)) {
    const members = Array.from(new Set(
      body.members.filter((e: unknown): e is string => typeof e === 'string' && isValidEmail(e.trim())).map((e: string) => e.trim().toLowerCase()),
    ));
    updateRow.members = members;
    updateRow.member_count = members.length;
  }
  if (body.smart_rules !== undefined) {
    const smartRules = parseSmartRules(body.smart_rules);
    if (!smartRules || smartRules.conditions.length === 0) {
      return NextResponse.json({ error: 'smart_rules must include at least one condition' }, { status: 400 });
    }
    updateRow.smart_rules = smartRules;
  }
  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const { data, error } = await adminClient().from('email_groups').update(updateRow).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ error: 'Failed to update group', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, group: data });
}

/** Refused (FK, error 23503) if a campaign references this group. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error } = await adminClient().from('email_groups').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      return NextResponse.json({ error: 'This group is used by one or more campaigns and cannot be deleted.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to delete group', details: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
