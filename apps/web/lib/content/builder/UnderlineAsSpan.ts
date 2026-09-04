// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * TipTap's stock Underline extension renders `<u>...</u>`, but
 * lib/content/sanitize-html.ts's ALLOWED_TAGS has no `<u>` (kept
 * deliberately narrow -- see that file's doc comment). Rather than widen
 * the sanitizer for one more tag, this overrides renderHTML to emit
 * `<span style="text-decoration: underline">...</span>` instead --
 * `text-decoration` is already in STYLE_VALIDATORS and `span` is already
 * an allowed tag, so this survives sanitization with no allowlist
 * changes. parseHTML is untouched (TipTap's default already matches both
 * `<u>` and `style="text-decoration: underline"`), so content saved this
 * way still round-trips correctly back into the editor.
 */
import { mergeAttributes } from '@tiptap/core';
import BaseUnderline from '@tiptap/extension-underline';

export const UnderlineAsSpan = BaseUnderline.extend({
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { style: 'text-decoration: underline' }), 0];
  },
});
