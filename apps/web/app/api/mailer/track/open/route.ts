// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/mailer/track/open?t=<tracking_token> -- the open-tracking
 * pixel src (see lib/mailer/tracking.ts's appendTrackingPixel). Public,
 * unauthenticated -- an email client fetches this with no session.
 * Always returns a real 1x1 transparent GIF, even for an unknown/expired
 * token, so a client's image renderer never shows a broken-image icon
 * (and so this endpoint doesn't leak whether a token is valid via a
 * different response shape).
 */

import { NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// 1x1 transparent GIF, the smallest valid tracking pixel.
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7', 'base64');

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function pixelResponse(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t');
  if (token) {
    // Best-effort -- a DB hiccup must never turn into a broken pixel.
    await adminClient().rpc('record_email_open', { p_token: token }).then(() => {}, () => {});
  }
  return pixelResponse();
}
