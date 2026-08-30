// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared Vantly OAuth callback for TWO distinct flows:
 *
 *   - "Connect with Vantly" (intent: 'connect') — links a Vantly account
 *     for publishing, on an already-signed-in vantly-ugc-app user. See
 *     /api/integrations/postiz/oauth/start.
 *   - "Sign in with Vantly" (intent: 'login') — signs the browser into
 *     vantly-ugc-app itself. See /api/auth/vantly.
 *
 * Both funnel here because Vantly allows exactly one OAuth App per
 * organization (vantly/libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service.ts's
 * createApp throws if one already exists) with a single fixed redirect URL
 * — Vantly's /oauth/authorize doesn't even accept a redirect_uri override.
 * So both start routes point at the same registered callback, and this
 * route tells them apart via `intent` in the CSRF-state cookie.
 *
 * Token exchange: POST {VANTLY_APP_URL}/api/oauth/token — verified against
 * oauth.service.ts's exchangeCodeForToken, which returns { id:
 * organizationId, cus: paymentId, access_token: 'pos_...', token_type:
 * 'bearer' }. This is an OPAQUE token, not a JWT, and carries no per-person
 * identity — only the Vantly ORGANIZATION that approved the request. That
 * means:
 *   - For 'connect', the access_token is stored in profiles.vantly_api_key
 *     and used identically to a manually-pasted API key everywhere
 *     downstream (Vantly's PublicAuthMiddleware accepts either raw in the
 *     Authorization header).
 *   - For 'login', "signing in with Vantly" necessarily means "signing in
 *     as this Vantly organization" — anyone who authorizes via the same
 *     Vantly org lands in the same vantly-ugc-app account. We link it via
 *     profiles.vantly_org_id (a pre-existing unique column, originally added
 *     for the old platform.postiz.com SSO login and unused since — see
 *     20260308000001_add_vantly_org_id_to_profiles.sql), keyed to the Vantly
 *     organizationId, with a synthetic sso.vantly-ugc.com email so Supabase
 *     Auth has something to key a real user record on.
 */

import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/request-origin';

const VANTLY_APP_URL = (process.env.VANTLY_APP_URL || 'https://vantly.social').replace(/\/+$/, '');
const VANTLY_TOKEN_URL = `${VANTLY_APP_URL}/api/oauth/token`;

type Intent = 'connect' | 'login';

function loginFailRedirect(origin: string, errorCode: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorCode)}`, origin));
  response.cookies.set('vantly_oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = getPublicOrigin(request);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const oauthError = searchParams.get('error');

  let redirect = '/integrations/vantly';
  let intent: Intent = 'connect';

  const cookieHeader = request.headers.get('cookie') || '';
  const stateMatch = cookieHeader.match(/vantly_oauth_state=([^;]+)/);

  const fail = (errorCode: string) => {
    if (intent === 'login') return loginFailRedirect(origin, errorCode);
    const response = NextResponse.redirect(new URL(`${redirect}?error=${encodeURIComponent(errorCode)}`, origin));
    response.cookies.set('vantly_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
    return response;
  };

  if (stateMatch) {
    try {
      const stored = JSON.parse(decodeURIComponent(stateMatch[1]));
      redirect = stored.redirect || redirect;
      intent = stored.intent === 'login' ? 'login' : 'connect';
      if (stored.state !== stateParam) {
        return fail('invalid_state');
      }
    } catch {
      return fail('invalid_state');
    }
  } else {
    return fail('invalid_state');
  }

  if (oauthError) {
    // The user denied consent, or Vantly rejected the request.
    return fail(oauthError === 'access_denied' ? 'access_denied' : 'vantly_oauth_error');
  }
  if (!code) {
    return fail('missing_code');
  }

  const clientId = process.env.VANTLY_CLIENT_ID;
  const clientSecret = process.env.VANTLY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('vantly_oauth_not_configured');
  }

  const supabase = await createClient();

  // For 'connect', this must still be an existing vantly-ugc-app session —
  // it links the connection to whichever user's session cookie survived the
  // round trip to Vantly and back (same browser, same domain, unaffected by
  // the redirect). 'login' has no session yet — that's the whole point.
  let currentUserId: string | null = null;
  if (intent === 'connect') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return fail('not_signed_in');
    }
    currentUserId = user.id;
  }

  let tokenData: { id?: string; access_token?: string; token_type?: string };
  try {
    const tokenRes = await fetch(VANTLY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => 'unknown');
      console.error('Vantly OAuth token exchange failed:', tokenRes.status, text);
      return fail('token_exchange');
    }
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('Vantly OAuth token exchange error:', err);
    return fail('token_exchange');
  }

  if (!tokenData.access_token) {
    console.error('Vantly OAuth token response missing access_token:', JSON.stringify(tokenData));
    return fail('token_exchange');
  }

  // ── intent: 'connect' — link the current user's profile ────────────────
  if (intent === 'connect') {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        vantly_api_key: tokenData.access_token,
        vantly_auth_method: 'oauth',
        vantly_oauth_org_id: tokenData.id ?? null,
        vantly_oauth_connected_at: new Date().toISOString(),
      })
      .eq('id', currentUserId as string);

    if (updateError) {
      console.error('Failed to save Vantly connection:', updateError);
      return fail('save_failed');
    }

    const response = NextResponse.redirect(new URL(`${redirect}?connected=1`, origin));
    response.cookies.set('vantly_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
    return response;
  }

  // ── intent: 'login' — sign in as this Vantly organization ───────────────
  const organizationId = tokenData.id;
  if (!organizationId) {
    console.error('Vantly OAuth login: token response missing organization id:', JSON.stringify(tokenData));
    return fail('no_org_id');
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Vantly OAuth login: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return fail('config');
  }
  const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

  const ssoEmail = `vantly_${organizationId}@sso.vantly-ugc.com`;
  let userId: string;

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: ssoEmail,
    email_confirm: true,
    user_metadata: {
      auth_provider: 'vantly',
      vantly_org_id: organizationId,
    },
  });

  if (newUser?.user) {
    userId = newUser.user.id;
    await supabaseAdmin.from('profiles').update({ vantly_org_id: organizationId }).eq('id', userId);
  } else if (createError?.message?.includes('already been registered')) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('vantly_org_id', organizationId)
      .maybeSingle();

    if (!profile?.id) {
      console.error('Vantly org already registered but profile not found:', organizationId);
      return fail('user_lookup');
    }
    userId = profile.id;
  } else {
    console.error('Failed to create Supabase user for Vantly login:', createError);
    return fail('user_creation');
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: ssoEmail,
  });

  if (linkError || !linkData) {
    console.error('Failed to generate session link for Vantly login:', linkError);
    return fail('session');
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError) {
    console.error('Failed to verify session for Vantly login:', verifyError);
    return fail('session');
  }

  const ALLOWED_PREFIXES = ['/gallery', '/billing', '/settings', '/subscribe', '/dashboard'];
  const safeRedirect = ALLOWED_PREFIXES.some(
    (p) => redirect === p || redirect.startsWith(p + '/') || redirect.startsWith(p + '?'),
  )
    ? redirect
    : '/gallery';

  const response = NextResponse.redirect(new URL(safeRedirect, origin));
  response.cookies.set('vantly_oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
