// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

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

interface UpdateBody {
  symbol?: unknown;
  name?: unknown;
  exchange_rate_to_usd?: unknown;
  is_active?: unknown;
  is_default?: unknown;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { code: rawCode } = await ctx.params;
  const code = rawCode.toUpperCase();

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const admin = adminClient();
  const patch: Record<string, unknown> = { updated_by: user.id };

  if (body.symbol !== undefined) {
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    if (!symbol || symbol.length > 8) return NextResponse.json({ error: 'symbol must be 1-8 chars' }, { status: 400 });
    patch.symbol = symbol;
  }
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    patch.name = name;
  }
  if (body.exchange_rate_to_usd !== undefined) {
    const rate = typeof body.exchange_rate_to_usd === 'number' ? body.exchange_rate_to_usd : Number(body.exchange_rate_to_usd);
    if (!Number.isFinite(rate) || rate <= 0) return NextResponse.json({ error: 'exchange_rate_to_usd must be a positive number' }, { status: 400 });
    patch.exchange_rate_to_usd = rate;
    patch.rate_source = 'manual';
    patch.rate_updated_at = new Date().toISOString();
  }
  if (body.is_active !== undefined) {
    if (body.is_active === false) {
      // A default currency must stay active — flip the default elsewhere first.
      const { data: row } = await admin.from('currencies').select('is_default').eq('code', code).maybeSingle();
      if (row?.is_default) {
        return NextResponse.json({ error: 'Cannot deactivate the default currency — set another currency as default first' }, { status: 409 });
      }
    }
    patch.is_active = !!body.is_active;
  }

  // Handle is_default separately: the unique partial index only allows one
  // is_default=true row, so clear any other default BEFORE setting this one.
  // Two sequential statements, not a single transaction — acceptable for an
  // admin-only, effectively single-writer settings action.
  if (body.is_default === true) {
    patch.is_default = true;
    patch.is_active = true; // a default must be active
    const { error: clearErr } = await admin.from('currencies').update({ is_default: false }).eq('is_default', true).neq('code', code);
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });
  } else if (body.is_default === false) {
    return NextResponse.json({ error: 'Set another currency as default instead of unsetting this one directly' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('currencies')
    .update(patch)
    .eq('code', code)
    .select('id, code, symbol, name, exchange_rate_to_usd, is_active, is_default, rate_source, rate_updated_at, updated_at')
    .single();
  if (error) {
    const status = (error as { code?: string }).code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: status === 404 ? `Currency ${code} not found` : error.message }, { status });
  }

  return NextResponse.json({ currency: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { code: rawCode } = await ctx.params;
  const code = rawCode.toUpperCase();

  if (code === 'USD') {
    return NextResponse.json({ error: 'USD is the baseline currency and cannot be removed' }, { status: 400 });
  }

  const admin = adminClient();
  const { data: row } = await admin.from('currencies').select('is_default').eq('code', code).maybeSingle();
  if (!row) return NextResponse.json({ error: `Currency ${code} not found` }, { status: 404 });
  if (row.is_default) {
    return NextResponse.json({ error: 'Cannot delete the default currency — set another currency as default first' }, { status: 409 });
  }

  const { error } = await admin.from('currencies').delete().eq('code', code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
