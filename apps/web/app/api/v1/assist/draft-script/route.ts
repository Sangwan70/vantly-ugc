// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for POST /v1/assist/draft-script — turns a one-line
 * pitch into a spoken UGC script draft. Used by the My Prompts wizard;
 * the result always lands in an editable textarea, never submitted as-is.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: { code: 'invalid_json' } }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${API_V2_URL}/v1/assist/draft-script`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: { message: text.slice(0, 400) } }; }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'upstream_unreachable', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
