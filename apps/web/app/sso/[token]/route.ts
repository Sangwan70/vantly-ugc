// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Vantly SSO endpoint.
 *
 * This is the receiving side of a bespoke bridge Vantly added specifically
 * for vantly-ugc-app: vantly/apps/backend/src/api/routes/users.controller.ts's
 * GET /vantly-ugc-sso (requires an existing vantly.social session) signs
 * { id: organization.id, displayName: organization.name } with a DEDICATED
 * secret, VANTLY_SSO_KEY (jsonwebtoken's `sign`, HS256 by default — NOT the
 * OAuth client_secret used by /api/auth/vantly and
 * /api/integrations/postiz/oauth/*), and redirects the browser to
 *   https://vantly-ugc.com/sso/{jwtToken}
 * which is this route. We verify the signature, then create-or-find a
 * Supabase user keyed to that organization id (profiles.vantly_org_id —
 * same column "Sign in with Vantly" uses, since both paths mean the same
 * thing: signing in as a Vantly organization, because Vantly's tokens have
 * no per-person identity — see /api/integrations/postiz/oauth/callback's
 * comments), sign them in, and redirect to the dashboard.
 *
 * This is initiated FROM vantly.social (a "launch vantly-ugc-app" link
 * there, if one exists) rather than from vantly-ugc-app's own login page —
 * for a login button on vantly-ugc-app itself, see /api/auth/vantly
 * instead, which reuses the same OAuth App credentials as the Vantly
 * connect flow.
 *
 * JWT payload actually sent by Vantly: { id: "org-id", displayName: "Org name" }.
 * (sub/name are read as fallbacks below only because this route predates
 * knowing Vantly's exact payload shape — id/displayName are what's real.)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createHmac, timingSafeEqual } from 'crypto';

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function verifyJwt(token: string, secret: string): { sub: string; name?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify HMAC-SHA256 signature
  const expectedSig = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  const actualSig = base64UrlDecode(signatureB64);

  if (expectedSig.length !== actualSig.length) return null;
  if (!timingSafeEqual(expectedSig, actualSig)) return null;

  // Decode payload
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));

    // Check expiration if present
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    // Accept both `sub` and `id` as user identifier (Vantly sends `id`)
    const userId = payload.sub || payload.id;
    if (!userId) return null;
    return { sub: userId, name: payload.name || payload.displayName };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { origin } = new URL(request.url);

  const ssoKey = process.env.VANTLY_SSO_KEY;
  if (!ssoKey) {
    console.error('VANTLY_SSO_KEY not configured');
    return NextResponse.redirect(new URL('/login?error=config', origin));
  }

  // ── Verify and decode the JWT ──────────────────────────────────────────
  const payload = verifyJwt(token, ssoKey);
  if (!payload) {
    console.error('Invalid or expired Vantly SSO token');
    return NextResponse.redirect(new URL('/login?error=invalid_token', origin));
  }

  const vantlyOrgId = payload.sub;
  const displayName = payload.name || null;

  // ── Create or find Supabase user ───────────────────────────────────────
  const supabaseAdmin = createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
  );

  const ssoEmail = `vantly_${vantlyOrgId}@sso.vantly-ugc.com`;

  // Try to create — if already exists, look up by vantly_org_id
  let userId: string;

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: ssoEmail,
    email_confirm: true,
    user_metadata: {
      full_name: displayName,
      vantly_org_id: vantlyOrgId,
      auth_provider: 'vantly',
    },
  });

  if (newUser?.user) {
    userId = newUser.user.id;

    // Store vantly_org_id in profiles
    await supabaseAdmin
      .from('profiles')
      .update({ vantly_org_id: vantlyOrgId })
      .eq('id', userId);
  } else if (createError?.message?.includes('already been registered')) {
    // Existing user — look up by vantly_org_id
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('vantly_org_id', vantlyOrgId)
      .maybeSingle();

    if (!profile?.id) {
      console.error('Vantly org already registered but profile not found:', vantlyOrgId);
      return NextResponse.redirect(new URL('/login?error=user_lookup', origin));
    }
    userId = profile.id;
  } else {
    console.error('Failed to create Supabase user:', createError);
    return NextResponse.redirect(new URL('/login?error=user_creation', origin));
  }

  // ── Generate a session ─────────────────────────────────────────────────
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: ssoEmail,
  });

  if (linkError || !linkData) {
    console.error('Failed to generate magic link:', linkError);
    return NextResponse.redirect(new URL('/login?error=session', origin));
  }

  // Exchange the token hash for a session
  const supabase = await createServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError) {
    console.error('Failed to verify magic link:', verifyError);
    return NextResponse.redirect(new URL('/login?error=session', origin));
  }

  // ── Redirect to dashboard ─────────────────────────────────────────────
  return NextResponse.redirect(new URL('/dashboard', origin));
}
