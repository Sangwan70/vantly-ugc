// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * The public-facing origin (scheme + host) to build absolute redirect URLs
 * from inside a Next.js route handler.
 *
 * `new URL(request.url).origin` looks right but is NOT reliable behind this
 * deployment's reverse proxy: the WHM/cPanel .htaccess in front of this app
 * proxies via mod_rewrite's [P] flag, which does not forward the original
 * Host header (ProxyPreserveHost can only be set in Apache's server/vhost
 * config, never in .htaccess — the same constraint noted in vantly.social's
 * own .htaccess). Without it, Next.js falls back to whatever address it's
 * actually bound to inside the container (0.0.0.0:3000), so any redirect
 * built from request.url's origin comes out as e.g.
 * https://0.0.0.0:3000/login instead of https://app.vantly-ugc.com/login —
 * a broken link no browser can follow (this is exactly what caused the
 * "Continue to VantlyUGC" SSO handoff to land on 0.0.0.0:3000/login).
 *
 * Fix: prefer APP_PUBLIC_URL (already set in .env.prod to this
 * deployment's real public URL) over the request's own origin. Falls back
 * to the request's own origin only if APP_PUBLIC_URL isn't set, so local
 * dev without it configured still works.
 */
export function getPublicOrigin(request: Request): string {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return new URL(request.url).origin;
}
