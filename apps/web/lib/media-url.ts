// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Builds the browser-reachable public URL for an object in a public
 * Supabase Storage bucket.
 *
 * Do NOT use `supabase.storage.from(bucket).getPublicUrl(path)` on a
 * server-side client for this. That client is constructed from SUPABASE_URL,
 * which in this self-hosted deployment is deliberately the internal
 * docker-network address (http://gateway:3000 — see docker-compose.yml,
 * every service container gets this so server-to-server Auth/REST/Storage
 * calls skip the public reverse proxy) — correct for the container, but a
 * URL built from it is unreachable from a browser. SUPABASE_PUBLIC_URL
 * (falling back to NEXT_PUBLIC_SUPABASE_URL) is the externally-reachable
 * address and the only one safe to store in a DB row or return to a client.
 */
export function publicStorageUrl(bucket: string, storagePath: string): string {
  const base = (process.env.SUPABASE_PUBLIC_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${bucket}/${storagePath}`;
}
