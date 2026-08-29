// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Fixed Supabase auth cookie name, shared by every client that reads or
 * writes the session cookie (browser, middleware, Server Components /
 * Route Handlers).
 *
 * @supabase/ssr defaults the cookie name to
 * `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` when no
 * override is given — i.e. it's derived from whichever URL each client
 * was constructed with. That's a trap in this self-hosted setup: the
 * BROWSER client is built with the PUBLIC url (e.g. http://localhost:8000
 * or https://app.vantly-ugc.com) so the page can actually reach it, while
 * server-side clients (middleware, Server Components) are built with the
 * INTERNAL Docker-network url (http://gateway:3000) so the request
 * doesn't have to bounce out through the public gateway. Those are
 * different hostnames, so the derived default names two DIFFERENT
 * cookies — the browser writes the verified session under one name, and
 * every server-side check looks for a different name, finds nothing, and
 * treats the visitor as signed out (OTP verify succeeds client-side, then
 * every protected route silently bounces back to /login).
 *
 * Pinning one explicit, URL-independent name on every client sidesteps
 * that: whichever URL a given client uses to actually reach Supabase,
 * they all agree on the same cookie.
 */
export const SUPABASE_COOKIE_NAME = 'sb-vantly-ugc-auth-token';
