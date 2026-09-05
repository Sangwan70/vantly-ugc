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

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: groups, error } = await adminClient()
    .from('email_groups')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to list groups', details: error.message }, { status: 500 });
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const type = body?.type === 'all_users' ? 'all_users' : body?.type === 'smart' ? 'smart' : 'manual';
  const members: string[] = type === 'manual' && Array.isArray(body?.members)
    ? Array.from(new Set(body.members.filter((e: unknown): e is string => typeof e === 'string' && isValidEmail(e.trim())).map((e: string) => e.trim().toLowerCase())))
    : [];
  const smartRules = type === 'smart' ? parseSmartRules(body?.smart_rules) : null;
  if (type === 'smart' && (!smartRules || smartRules.conditions.length === 0)) {
    return NextResponse.json({ error: 'smart_rules with at least one condition is required for smart groups' }, { status: 400 });
  }

  const { data: created, error } = await adminClient()
    .from('email_groups')
    .insert({ name, type, members, member_count: members.length, smart_rules: smartRules, created_by: user.id })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Failed to create group', details: error.message }, { status: 500 });
  return NextResponse.json({ success: true, group: created });
}
