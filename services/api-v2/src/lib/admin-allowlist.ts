// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Server-side admin allowlist for api-v2 — mirrors
 * apps/web/lib/admin-allowlist.ts's ADMIN_EMAILS/isAdminEmail exactly (same
 * env var, same fail-closed empty default), so an operator sets ADMIN_EMAILS
 * once and both the dashboard and the API agree on who's an admin.
 *
 * Used to bypass credit checks/deductions for admins and to report
 * "unlimited credits" in balance responses — see routes/v1/skills.ts
 * (preflightCreditCheck, quoteSkillRoute) and routes/v1/credits-check.ts.
 */
const ADMIN_EMAILS = new Set<string>(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}
