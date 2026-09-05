// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * The two placeholders Content Management's render pipeline substitutes
 * (see lib/content/render-vars.ts and its callers -- privacy/terms/
 * contact page.tsx) -- exposed here so InlineTextEditor's "Variable"
 * dropdown can insert them into a static page's WysiwygEditor without an
 * admin needing to remember the exact `{{...}}` spelling.
 *
 * InlineTextEditor is also reused by the Mailer Templates Canvas builder's
 * Text block (ContentBuilder.tsx, see its own doc comment for why it
 * lives there now), where this same dropdown currently still offers these
 * two Content-Management-only tokens even though Mailer's actual
 * substitution keys are per-template and admin-defined (the "Documented
 * variables" field on the template, substituted by lib/mailer/
 * render-template.ts at send time) -- a known cosmetic mismatch, not a
 * functional one: an admin can always type any `{{key}}` by hand in
 * either mode, and an unmatched token is simply left as literal text by
 * both render pipelines rather than failing. Threading each template's
 * own documented variables into this dropdown (instead of this fixed
 * list) would need a `variableGroups` prop plumbed through Canvas ->
 * BlockViews -> InlineTextEditor -- worth doing if this mismatch proves
 * confusing in practice, not done here.
 */
export interface VariableItem {
  label: string;
  token: string;
}

export interface VariableGroup {
  label: string;
  items: VariableItem[];
}

export const VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: 'Site',
    items: [
      { label: 'Site URL', token: '{{site_url}}' },
      { label: 'Support contact', token: '{{support_contact}}' },
    ],
  },
];
