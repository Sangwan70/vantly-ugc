// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

/**
 * Hosts Next/Image is allowed to optimize.
 *
 * These MUST be known at build time (Next bakes them into the image optimizer),
 * which is the one place the otherwise-runtime config cannot reach. So they are
 * derived from build args with the hosted defaults as a fallback:
 *
 *   NEXT_PUBLIC_IMAGE_HOSTS=cdn.example.com,minio.example.com
 *
 * A self-hoster whose media lives on their own bucket must set this, or images
 * will 400 from the optimizer. Docker build arg: --build-arg NEXT_PUBLIC_IMAGE_HOSTS=...
 */
function imageHosts(): { protocol: 'http' | 'https'; hostname: string }[] {
  const raw = process.env.NEXT_PUBLIC_IMAGE_HOSTS?.trim();
  const hosts = raw
    ? raw
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : [];

  // Also allow whatever Supabase / object-storage origins are configured.
  for (const v of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]) {
    if (!v?.trim()) continue;
    try {
      hosts.push(new URL(v).hostname);
    } catch {
      // Ignore malformed values — a bad URL here should not fail the build.
    }
  }

  const unique = [...new Set(hosts)];
  return unique.map((hostname) => ({
    // localhost/MinIO in a self-host setup is plain http.
    protocol: /^(localhost|127\.0\.0\.1|minio)(:|$)/.test(hostname) ? 'http' : 'https',
    hostname,
  }));
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vantly-ugc/ui'],
  experimental: {
    // Next buffers the body of any request matched by middleware.ts's
    // matcher (which covers /api/v1/* -- see its comment) so middleware
    // COULD read it, even though most routes never do. Past this limit,
    // Next does NOT reject the request: it silently truncates the body
    // and lets the route handler run on the partial data, logging only a
    // console warning ("Request body exceeded ... Only the first N MB
    // will be available"). That is exactly what broke
    // /api/v1/skills/[slug]/run for make_storybook -- a 12.7MB request
    // (4 uncompressed cast photos) got cut to the platform's *implicit*
    // default of 10MB, and the truncated JSON failed to parse server-side
    // as a confusing "invalid_json" instead of a clear size error.
    // Pinning the same 10MB here doesn't change current behavior -- it
    // makes the limit explicit and documented instead of an invisible
    // platform default that could shift on a future Next upgrade. It
    // does NOT by itself turn truncation into a clean client error for
    // every /api/v1/* route -- routes need their own Content-Length
    // pre-check for that (see videos/route.ts and skills/[slug]/run/
    // route.ts, both of which reject well below this ceiling before ever
    // reading the body).
    middlewareClientMaxBodySize: 10 * 1024 * 1024,
  },
  // Emit a self-contained server bundle so the Docker image does not need the
  // whole pnpm workspace at runtime. See apps/web/Dockerfile.
  output: 'standalone',
  images: {
    remotePatterns: imageHosts(),
    formats: ['image/avif', 'image/webp'],
  },
  // Legacy pre-redesign pages that read stale/legacy-only data sources
  // (generation_jobs directly, via the Supabase client) rather than the
  // merged /v1/me/gallery feed the current dashboard uses. Since every
  // generation now goes through the vNext skill_runs/primitive_runs
  // pipeline, these old pages render permanently empty for any account
  // whose work all happened post-migration — confirmed live: a finished
  // make_ugc_video run was completely invisible on /gallery even though
  // it showed up correctly on /dashboard/gallery. Their (dashboard)
  // route-group counterparts (/actors, /integrations/vantly, etc.) are
  // still the live, un-migrated implementation for those features and are
  // deliberately NOT redirected here — only gallery/jobs have an
  // (app-dark) replacement so far. Not `permanent: true` (308) so this
  // stays easy to adjust while the old→new migration is still in progress;
  // switch to permanent once the legacy pages are actually deleted.
  async redirects() {
    return [
      { source: '/gallery', destination: '/dashboard/gallery', permanent: false },
      { source: '/jobs', destination: '/dashboard/jobs', permanent: false },
    ];
  },
};

// NOTE: the hosted site's marketing redirects (/ai-ugc-video-generator, /blog/*,
// /compare/*, …) are deliberately absent. This distribution ships the DASHBOARD
// only — those targets do not exist here, so the rules would have redirected
// people to 404s.

// Wrap with Sentry. Source-map upload only runs when SENTRY_AUTH_TOKEN +
// SENTRY_ORG + SENTRY_PROJECT are set; otherwise it's a safe no-op and the
// build proceeds normally.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  tunnelRoute: '/monitoring',
});
