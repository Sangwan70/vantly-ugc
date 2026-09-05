// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/mailer/unsubscribe?email=<addr>&sig=<hmac> -- the one-click
 * unsubscribe link every campaign send's footer carries (see
 * lib/mailer/tracking.ts's buildUnsubscribeUrl). Public, unauthenticated
 * by design -- this is the entire point of a one-click unsubscribe link,
 * same as every commercial ESP. `sig` (HMAC-SHA256 over the email,
 * verified with a constant-time comparison) stops someone from
 * mass-unsubscribing arbitrary addresses they don't own by hand-crafting
 * URLs; it does NOT make this an authenticated action in the "proves you
 * are that person" sense, which one-click unsubscribe links never do.
 *
 * Renders a plain confirmation HTML page (a human clicks this in a
 * browser) rather than JSON.
 */

import { NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { verifyUnsubscribeSignature } from '@/lib/mailer/tracking';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function htmlPage(title: string, message: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0F1015;color:#E9E9F0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;}
main{max-width:420px;padding:32px;text-align:center;}
h1{font-size:20px;font-weight:600;margin:0 0 8px;}
p{color:rgba(255,255,255,0.6);font-size:14px;line-height:1.5;}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim() ?? '';
  const sig = req.nextUrl.searchParams.get('sig')?.trim() ?? '';

  if (!email || !sig || !verifyUnsubscribeSignature(email, sig)) {
    return htmlPage('Invalid unsubscribe link', 'This unsubscribe link is invalid or has expired. If you no longer want these emails, contact the sender directly.', 400);
  }

  const { error } = await adminClient().rpc('add_email_suppression', { p_email: email, p_reason: 'unsubscribed', p_campaign_id: null });
  if (error) {
    return htmlPage('Something went wrong', "We couldn't process your unsubscribe request right now. Please try again in a moment.", 500);
  }

  return htmlPage('You’re unsubscribed', `${email} won’t receive any more emails from this list.`, 200);
}
