// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Rewrite a Supabase Storage URL's origin to the browser-reachable public
 * one before handing it to client-side code.
 *
 * `lib/supabase/server.ts`'s createClient() deliberately prefers the
 * internal SUPABASE_URL (docker-compose.yml: `http://gateway:3000`) over
 * NEXT_PUBLIC_SUPABASE_URL, because almost every server-side call
 * (auth.getUser(), .getSession(), REST queries) is made BY this container
 * and never leaves the docker network -- using the internal address is
 * faster and skips an unnecessary public round-trip.
 *
 * Storage signed URLs are the one exception: createSignedUrl() /
 * createSignedUploadUrl() bake the CLIENT's configured base URL into the
 * returned link, but that link is handed to the BROWSER to fetch/PUT
 * directly -- so an internal-only origin like http://gateway:3000 is
 * unreachable from outside the docker network, is plain HTTP, and isn't
 * even on the CSP connect-src allowlist. This turned into a real bug:
 * image uploads on /dashboard/agent failed with
 * "Refused to connect because it violates the document's Content Security
 * Policy" against a literal `gateway:3000` URL in the browser console.
 *
 * Any route that returns a storage signed URL for the browser to use
 * directly (a PUT target, an <img src>, a client-side fetch) MUST pass it
 * through this first.
 */
export function toPublicStorageUrl(url: string): string {
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!publicBase) return url;
  try {
    const target = new URL(url);
    const pub = new URL(publicBase);
    target.protocol = pub.protocol;
    target.hostname = pub.hostname;
    // IMPORTANT: `target.host = pub.host` looks equivalent but isn't -- the
    // WHATWG URL `host` setter only updates the port when the assigned
    // string itself contains one. NEXT_PUBLIC_SUPABASE_URL is a bare
    // "https://auth.vantly-ugc.com" with no port, so `pub.host` also has no
    // port, and the setter then leaves `target`'s ORIGINAL port (:3000,
    // from the internal http://gateway:3000 URL) untouched -- producing
    // "https://auth.vantly-ugc.com:3000/...", which is just as unreachable
    // and CSP-blocked as the internal hostname was. Set `.port` explicitly
    // (to pub.port, which is '' here) so it's actually cleared.
    target.port = pub.port;
    return target.toString();
  } catch {
    return url;
  }
}
