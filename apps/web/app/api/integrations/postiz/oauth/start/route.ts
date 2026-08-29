// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * "Connect with Vantly" OAuth initiation.
 *
 * This is a publish-connection flow, NOT a login method — the caller must
 * already be signed into vantly-ugc-app (see /integrations/vantly). It
 * generates a CSRF state token, stores it in a short-lived cookie, and sends
 * the browser to Vantly's own OAuth consent screen
 * (apps/frontend/src/app/(app)/oauth/authorize on vantly.social).
 *
 * Vantly's /oauth/authorize + /oauth/token flow (verified against
 * vantly/apps/backend/src/api/routes/oauth.controller.ts) has no
 * redirect_uri parameter at all — the callback URL is whatever was set once
 * when registering the OAuth App on Vantly (Settings -> OAuth App), and that
 * value MUST exactly match this deployment's
 * /api/integrations/postiz/oauth/callback route. See .env.example for
 * VANTLY_CLIENT_ID / VANTLY_APP_URL / APP_PUBLIC_URL.
 *
 * The same callback also serves "Sign in with Vantly" (see
 * /api/auth/vantly/route.ts) — Vantly only allows one OAuth App per
 * organization with one fixed redirect URL, so both flows share this
 * callback and are told apart by `intent` ('connect' here) in the
 * CSRF-state cookie.
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';

const VANTLY_APP_URL = (process.env.VANTLY_APP_URL || 'https://vantly.social').replace(/\/+$/, '');

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const redirect = searchParams.get('redirect') || '/integrations/vantly';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(redirect)}`, origin));
  }

  const clientId = process.env.VANTLY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL(`${redirect}?error=vantly_oauth_not_configured`, origin));
  }

  const state = randomBytes(32).toString('hex');

  const authorizeUrl = new URL(`${VANTLY_APP_URL}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl.toString());

  response.cookies.set('vantly_oauth_state', JSON.stringify({ state, redirect, intent: 'connect' }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — the consent step should take seconds, not longer.
    path: '/',
  });

  return response;
}
