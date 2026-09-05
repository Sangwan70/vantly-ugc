// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/mailer/track/click?t=<tracking_token>&u=<encoded destination>
 * -- every http(s) link in a sent campaign is rewritten to point here
 * (see lib/mailer/tracking.ts's rewriteLinksForTracking). Public,
 * unauthenticated. Records the click (best-effort) then 302s to the
 * original URL -- `u` only ever originates from our own rendered,
 * sanitizer-cleared template HTML (never from arbitrary user input), but
 * it's still validated as an absolute http(s) URL before redirecting, on
 * general open-redirect-hardening principle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function isSafeRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t');
  const destination = req.nextUrl.searchParams.get('u');

  if (!destination || !isSafeRedirectTarget(destination)) {
    return NextResponse.json({ error: 'Missing or invalid redirect target' }, { status: 400 });
  }

  if (token) {
    await adminClient().rpc('record_email_click', { p_token: token }).then(() => {}, () => {});
  }

  return NextResponse.redirect(destination, { status: 302 });
}
