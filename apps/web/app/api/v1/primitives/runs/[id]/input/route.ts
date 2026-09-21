// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

/**
 * Same-origin proxy for GET /v1/primitives/runs/:id/input — a standalone
 * primitive run's original dispatch input. Mirrors
 * app/api/v1/skills/runs/[id]/input/route.ts's composed-run equivalent;
 * see that file's comment for why this is its own endpoint rather than
 * folded into the polled run-status proxy. Read by the run-detail page's
 * "Prompt & inputs" section (dashboard/skills/_run-input-view.tsx).
 */
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
    const upstream = await fetch(`${API_V2_URL}/v1/primitives/runs/${encodeURIComponent(id)}/input`, {
      method: 'GET',
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
