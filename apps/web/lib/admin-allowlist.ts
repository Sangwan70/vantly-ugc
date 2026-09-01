// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Admin access allowlist for the /dashboard/admin panel and /api/admin/* routes.
 *
 * Configured, not hardcoded: set ADMIN_EMAILS to a comma-separated list.
 * The default is EMPTY — a fresh deployment grants admin to nobody until the
 * operator opts someone in. That fail-closed default matters for self-hosters:
 * shipping a populated allowlist would hand the upstream maintainers admin on
 * every downstream install.
 *
 *   ADMIN_EMAILS=alice@example.com,bob@example.com
 *
 * `isAdminEmail`/`ADMIN_EMAILS` below read `process.env.ADMIN_EMAILS` at
 * MODULE LOAD, which is only correct in server-only code (the /api/admin/*
 * route handlers) — Next.js inlines `process.env.*` reads at build time for
 * anything that ends up in the client bundle, and ADMIN_EMAILS (no
 * NEXT_PUBLIC_ prefix) isn't inlined at all, so a 'use client' component
 * importing this always sees an empty set, regardless of what's set on the
 * server. That's exactly what made /dashboard/admin show "Not authorized"
 * even with ADMIN_EMAILS correctly set on the VPS — the client-side gate
 * never had a real value to check against.
 *
 * Client components must NOT import ADMIN_EMAILS/isAdminEmail. Use
 * `isAdminEmailIn(email, useVariables().adminEmails)` instead — adminEmails
 * comes from NEXT_PUBLIC_ADMIN_EMAILS, threaded in at REQUEST time by the
 * root layout (see components/variable-context.tsx), so one Docker image
 * still serves any environment without a rebuild.
 */
export const ADMIN_EMAILS = new Set<string>(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Server-only. Safe in /api/admin/* route handlers; do NOT import this into a 'use client' component. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

/**
 * Client-safe admin check: pass the caller's email and the
 * `adminEmails` string from `useVariables()` (sourced from
 * NEXT_PUBLIC_ADMIN_EMAILS, resolved at request time — never bundled).
 */
export function isAdminEmailIn(email: string | null | undefined, adminEmailsCsv: string): boolean {
  if (!email) return false;
  const set = new Set(
    (adminEmailsCsv ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.toLowerCase());
}
