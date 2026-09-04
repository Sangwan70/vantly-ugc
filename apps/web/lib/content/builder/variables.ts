// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * The only two placeholders the render pipeline actually substitutes
 * (see lib/content/render-vars.ts and its two callers, privacy/terms
 * page.tsx) -- exposed here so the inline text editor's "Variable"
 * dropdown can insert them without an admin needing to remember the
 * exact `{{...}}` spelling.
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
