// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Emails exempt from the subscription wall (middleware.ts).
 *
 * Configured, not hardcoded: set EXEMPTED_EMAILS to a comma-separated list —
 * internal employees, admins, or anyone else who should get full app access
 * without ever hitting /subscribe or /onboarding/plan. This does NOT grant
 * credits or admin rights on its own (see lib/admin-allowlist.ts for admin);
 * it only bypasses the "must have an active subscription" gate. The default
 * is EMPTY, matching ADMIN_EMAILS's fail-closed default.
 *
 *   EXEMPTED_EMAILS=alice@example.com,bob@example.com
 */
export const EXEMPTED_EMAILS = new Set<string>(
  (process.env.EXEMPTED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isExemptedEmail(email: string | null | undefined): boolean {
  return !!email && EXEMPTED_EMAILS.has(email.toLowerCase());
}
