// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Plain {{key}} substitution for static_pages.content_html, so privacy/terms
 * can keep referencing the operator's own site URL / support contact
 * without baking a specific deployment's values into the sanitized HTML
 * stored in the database. Deliberately the same tiny, dependency-free
 * approach as apps/web/lib/mailer/render-template.ts (duplicated rather
 * than imported from the mailer feature -- this is a 5-line function with
 * no reason to couple two unrelated features together over).
 */
export function renderContentVars(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}
