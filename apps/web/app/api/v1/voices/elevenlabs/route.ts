// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/voices/elevenlabs — lists the ElevenLabs
 * voices available for the agent composer's "Voice Actor" picker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '')
  ?? 'https://api.vantly-ugc.com';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  try {
    const upstream = await fetch(`${API_V2_URL}/v1/voices/elevenlabs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
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
