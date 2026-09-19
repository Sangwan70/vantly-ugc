// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  try {
    // Polled every few seconds by the run-detail page -- Next.js's fetch
    // Data Cache defaults GET requests to cacheable, and this route was
    // silently serving the FIRST-ever response forever (confirmed live:
    // a run that finished in 26 minutes still showed its 20-second-old
    // "characters/submitted" snapshot 27+ minutes later). See
    // dashboard/job/[id]/route.ts for the same fix already applied to the
    // legacy jobs-polling route -- this one just missed it.
    const upstream = await fetch(`${API_V2_URL}/v1/skills/runs/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
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
