// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for /v1/me/gallery — merged legacy + vNext
 * recent-generations feed for the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Per-user private data proxied through here -- see the matching comment on
// api-v2's GET /v1/me/gallery. Force dynamic (never statically/route-cached)
// and tell the browser/any intermediate proxy never to cache this response,
// so one signed-in user's gallery can never be served to the next person who
// hits the same URL (e.g. the default '/api/v1/me/gallery?limit=60' every
// dashboard load requests) in a shared browser or behind a CDN.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  const params = new URLSearchParams();
  params.set('limit', req.nextUrl.searchParams.get('limit') ?? '40');
  params.set('offset', req.nextUrl.searchParams.get('offset') ?? '0');
  const filter = req.nextUrl.searchParams.get('filter');
  if (filter) params.set('filter', filter);
  const primitive = req.nextUrl.searchParams.get('primitive');
  if (primitive) params.set('primitive', primitive);
  const skill = req.nextUrl.searchParams.get('skill');
  if (skill) params.set('skill', skill);
  const q = req.nextUrl.searchParams.get('q');
  if (q) params.set('q', q);
  const media = req.nextUrl.searchParams.get('media');
  if (media) params.set('media', media);
  try {
    const upstream = await fetch(`${API_V2_URL}/v1/me/gallery?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: { code: 'upstream_error', message: text.slice(0, 400) } };
    }
    return NextResponse.json(data, {
      status: upstream.status,
      headers: { 'Cache-Control': 'private, no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'upstream_unreachable', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
