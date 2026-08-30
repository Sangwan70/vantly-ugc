// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * "Sign in with Vantly" — login initiation (NOT the same as the
 * "Connect with Vantly" publish-connection flow at
 * /api/integrations/postiz/oauth/start).
 *
 * Vantly allows exactly one OAuth App per organization (see
 * vantly/libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service.ts's
 * createApp, which throws if one already exists), and that one app has a
 * single, fixed redirect URL with no per-request override (Vantly's
 * /oauth/authorize doesn't even accept a redirect_uri param). So this route
 * and the connect-flow's start route both send the browser to the SAME
 * Vantly consent screen using the SAME client_id, and Vantly always sends
 * the user back to the ONE registered callback:
 * /api/integrations/postiz/oauth/callback.
 *
 * That shared callback tells the two flows apart via `intent` in the
 * CSRF-state cookie ('login' vs 'connect') and branches its behavior
 * accordingly — see that route for the login-specific logic (there is no
 * per-person identity available from Vantly's token exchange, only an
 * organizationId, so "login" means "sign in as this Vantly organization").
 */

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getPublicOrigin } from '@/lib/request-origin';

const VANTLY_APP_URL = (process.env.VANTLY_APP_URL || 'https://vantly.social').replace(/\/+$/, '');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = getPublicOrigin(request);
  const redirect = searchParams.get('redirect') || '/dashboard';

  const clientId = process.env.VANTLY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL(`/login?error=vantly_oauth_not_configured`, origin));
  }

  const state = randomBytes(32).toString('hex');

  const authorizeUrl = new URL(`${VANTLY_APP_URL}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl.toString());

  response.cookies.set('vantly_oauth_state', JSON.stringify({ state, redirect, intent: 'login' }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — the consent step should take seconds, not longer.
    path: '/',
  });

  return response;
}
