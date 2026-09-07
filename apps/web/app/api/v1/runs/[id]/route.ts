// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for /v1/runs/:id — hard-delete one run's R2 media
 * and DB row (real delete, not the soft-archive pattern schedules/chats
 * use). Requires ?source=legacy|vnext_skill|vnext_primitive, forwarded
 * from the Jobs page which already knows each row's GalleryItem.source.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const source = req.nextUrl.searchParams.get('source');
  if (!source) {
    return NextResponse.json({ error: { code: 'missing_source', message: 'source query param is required' } }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }
  try {
    const upstream = await fetch(
      `${API_V2_URL}/v1/runs/${encodeURIComponent(id)}?source=${encodeURIComponent(source)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    const text = await upstream.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: { code: 'upstream_error', message: text.slice(0, 400) } }; }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'upstream_unreachable', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
