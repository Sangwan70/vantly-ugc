// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { getVar } from '@/components/variable-context';

/**
 * Where "home" is, and how to leave cleanly.
 *
 * The marketing site and the product are two deployments on two hosts. Inside
 * this app, `/` is not the marketing site — on app.vantly-ugc.com middleware
 * sends a signed-out visitor from `/` straight back to `/login`. So every
 * "Home" affordance that linked to `/` did nothing at all: it bounced the user
 * back to the page they were already on.
 *
 * Configurable because a self-hoster has no separate marketing host; set
 * NEXT_PUBLIC_MARKETING_URL to their own, or leave it and get ours.
 */
export const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL?.trim() || 'https://vantly-ugc.com';

/**
 * Where GoTrue (Supabase Auth) should send the browser back to after a
 * "Continue with Google" round trip, regardless of which host --
 * marketing or app -- the button was clicked from.
 *
 * GoTrue only honors a `redirectTo` that matches its configured Site
 * URL (GOTRUE_SITE_URL in docker-compose.yml, set from APP_PUBLIC_URL
 * -- i.e. the app host); GOTRUE_URI_ALLOW_LIST isn't set, so nothing
 * else is allow-listed. Send it `https://vantly-ugc.com/auth/callback`
 * instead (window.location.origin on the marketing host) and GoTrue
 * silently swaps it for the bare Site URL with only `?code=` appended
 * -- no path, no `redirect` param -- so it never reaches our
 * /auth/callback route at all and no session gets created. (And even
 * if it did: the marketing host's cookies wouldn't be visible on the
 * app host anyway -- see clearSessionHint's comment above for why we
 * deliberately don't widen the cookie domain to fix that instead.)
 *
 * So every OAuth-initiating button must build its `redirectTo` from
 * this helper, never from `window.location.origin` directly.
 *
 * Reads APP_PUBLIC_URL via the runtime variable-context (see
 * lib/supabase/client.ts's own comment for why: NEXT_PUBLIC_* would be
 * inlined into the browser bundle at BUILD time, baking one
 * deployment's app host into the image forever) -- the exact same env
 * var GOTRUE_SITE_URL itself is already set from, so this always
 * agrees with what GoTrue will actually accept, with zero extra
 * configuration. Falls back to the current origin when it's unset,
 * which is exactly correct for the single-host default (nothing to
 * correct for).
 */
export function getOAuthRedirectTo(redirectPath: string): string {
  const base = getVar('appPublicUrl', typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/auth/callback?redirect=${encodeURIComponent(redirectPath)}`;
}

/** Mirrors SESSION_HINT in middleware.ts. */
const SESSION_HINT = 'am_session_hint';

/**
 * Clear the parent-domain session hint from the browser.
 *
 * Middleware clears this automatically, but only on a request that reaches
 * THIS app. Sign-out now sends people to the marketing site, which is a
 * different deployment — so without this the hint would still say "1" when
 * vantly-ugc.com reads it, and its middleware would bounce the freshly
 * signed-out user to app.vantly-ugc.com/dashboard, which would bounce them to
 * /login. They would never see the marketing page they asked for.
 *
 * The cookie is deliberately httpOnly:false (it carries no credential) so the
 * client can do exactly this.
 *
 * The domain must match the one it was set with or the delete is a no-op, and
 * we cannot read that env var from the client, so derive it from the current
 * host: `app.vantly-ugc.com` → `.vantly-ugc.com`. On localhost there is no
 * parent domain and nothing to clear.
 */
export function clearSessionHint(): void {
  if (typeof document === 'undefined') return;

  const host = window.location.hostname;
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return;

  const parts = host.split('.');
  if (parts.length < 2) return;
  const parent = `.${parts.slice(-2).join('.')}`;

  const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
  // Clear at both scopes: the parent domain it was written to, and the current
  // host in case an older build ever wrote a host-only copy.
  document.cookie = `${SESSION_HINT}=; path=/; domain=${parent}; expires=${expired}; SameSite=Lax; Secure`;
  document.cookie = `${SESSION_HINT}=; path=/; expires=${expired}; SameSite=Lax; Secure`;
}

/**
 * Sign-out destination. Send people to the marketing site rather than /login:
 * someone who just signed out is leaving, and parking them on a login form is
 * asking them to do the thing they just undid.
 */
export function goToMarketingSite(): void {
  clearSessionHint();
  window.location.href = MARKETING_URL;
}

/**
 * This deployment's own app-host origin, resolved the same
 * runtime-appPublicUrl-with-current-origin-fallback way getOAuthRedirectTo
 * does (see its comment above for why this can't be a build-time
 * NEXT_PUBLIC_* read). On a plain single-host self-install, where
 * appPublicUrl is unset, this is just the current origin -- exactly
 * correct, since there's nowhere else to send anyone.
 */
function getAppOrigin(): string {
  return getVar('appPublicUrl', typeof window !== 'undefined' ? window.location.origin : '');
}

/**
 * Where every marketing-page "Get Started" / "Start generating" CTA
 * should send a signed-out visitor to sign in.
 *
 * These buttons render on the marketing host (vantly-ugc.com). A session
 * created by a login MODAL opened from there is a cookie scoped to THAT
 * host -- app.vantly-ugc.com's middleware, which is what actually guards
 * /dashboard, can never see it. A visitor who "logged in" via a homepage
 * modal would look signed in right there and still hit /login all over
 * again the moment they reached the app. That's why these buttons are
 * plain links straight to the app host's real /login page rather than
 * openLogin() calls -- sign-in always has to happen on the origin that
 * will actually need to read the resulting cookie.
 */
export function getAppLoginUrl(): string {
  return `${getAppOrigin()}/login`;
}

/** Where the header's "Dashboard" link (shown to an already-signed-in
 *  visitor, via hasSessionHint() below) should go -- same cross-host
 *  reasoning as getAppLoginUrl(). */
export function getAppDashboardUrl(): string {
  return `${getAppOrigin()}/dashboard`;
}

/** Where the header's "Logout" link should go: a small page on the app
 *  host (where the real session cookie lives) that signs out and bounces
 *  back here. Plain link rather than a client-side supabase.auth.signOut()
 *  call from the marketing origin, which would have no session to sign out
 *  of in the first place. */
export function getAppLogoutUrl(): string {
  return `${getAppOrigin()}/logout`;
}

/**
 * Whether THIS browser looks signed in, per the cross-domain hint cookie
 * middleware.ts writes (`am_session_hint`, Domain=SESSION_HINT_DOMAIN, no
 * credential in it -- see that file's own comment). This is the only way
 * the marketing host can know: the real Supabase session cookie is scoped
 * to the app host and never reaches here. False (and always false) when
 * SESSION_HINT_DOMAIN isn't configured, same as a single-host install
 * where this whole cross-host question doesn't arise.
 */
export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === `${SESSION_HINT}=1`);
}
