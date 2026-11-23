// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for api-v2's /v1/studio/* (Voiceover Studio). Forwards the
 * method, JSON body and the user's Supabase session as a Bearer token, so the
 * dashboard never needs api-v2's hostname in its CSP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '') ?? 'https://api.vantly-ugc.com';

// TTS for a long paragraph can take a while on ElevenLabs.
export const maxDuration = 120;

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await ctx.params;
  if (!path?.length || path.some((p) => p === '..' || p.includes('/'))) {
    return NextResponse.json({ error: { code: 'bad_path' } }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  const url = `${API_V2_URL}/v1/studio/${path.map(encodeURIComponent).join('/')}`;
  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? await req.text() : undefined,
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    const text = await upstream.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: { code: 'upstream_error', message: text.slice(0, 400) } }; }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json({ error: { code: 'upstream_unreachable', message: (err as Error).message } }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
