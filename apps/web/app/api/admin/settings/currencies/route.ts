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

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient()
    .from('currencies')
    .select('id, code, symbol, name, exchange_rate_to_usd, is_active, is_default, rate_source, rate_updated_at, updated_at')
    .order('is_default', { ascending: false })
    .order('code', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ currencies: data ?? [] });
}

interface CreateBody {
  code?: unknown;
  symbol?: unknown;
  name?: unknown;
  exchange_rate_to_usd?: unknown;
  is_active?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rate = typeof body.exchange_rate_to_usd === 'number' ? body.exchange_rate_to_usd : Number(body.exchange_rate_to_usd);

  if (!/^[A-Z]{3}$/.test(code)) {
    return NextResponse.json({ error: 'code must be a 3-letter ISO 4217 currency code (e.g. INR)' }, { status: 400 });
  }
  if (!symbol || symbol.length > 8) {
    return NextResponse.json({ error: 'symbol is required (≤ 8 chars)' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: 'exchange_rate_to_usd must be a positive number' }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from('currencies')
    .insert({
      code, symbol, name,
      exchange_rate_to_usd: rate,
      is_active: body.is_active !== false,
      rate_source: 'manual',
      updated_by: user.id,
    })
    .select('id, code, symbol, name, exchange_rate_to_usd, is_active, is_default, rate_source, rate_updated_at, updated_at')
    .single();
  if (error) {
    const status = error.code === '23505' ? 409 : 500; // unique_violation on code
    return NextResponse.json({ error: error.code === '23505' ? `Currency ${code} already exists` : error.message }, { status });
  }

  return NextResponse.json({ currency: data }, { status: 201 });
}
