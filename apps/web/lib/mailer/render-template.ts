// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Plain {{key}} string substitution -- deliberately not a real template
 * engine (no conditionals/loops/escaping modes). Matches the plan
 * document's own verdict for Vantly's Templates feature: "raw HTML/Jinja
 * editing + live preview is enough," minus even the Jinja part, since
 * nothing here needs more than variable substitution yet.
 *
 * Unknown {{key}} tokens are left as-is (not blanked) so a preview clearly
 * shows what's still missing, rather than silently rendering an empty gap.
 */
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

/** Simple, permissive email-shape check -- matches the regex already used in apps/web/app/api/admin/settings/mailer/route.ts. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
