// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Adds a `fontSize` attribute to TipTap's TextStyle mark (rendered as an
 * inline `style="font-size: ..."` on the wrapping <span>) so the Text
 * block's toolbar can offer a font-size dropdown -- matching AutoGPT's
 * BlogPostEditor capability.
 *
 * Deliberately does NOT add a typed `setFontSize` chain command via
 * module augmentation of @tiptap/core's Commands interface -- that
 * pattern (declare module '@tiptap/core' { interface Commands... }) hit a
 * build failure in this monorepo's pnpm layout when AutoGPT's own
 * equivalent extension was ported here previously (see
 * UnderlineAsSpan.ts's sibling history). Callers instead use TipTap's
 * generic, already-typed `setMark`/`unsetMark` commands directly:
 *   editor.chain().focus().setMark('textStyle', { fontSize: '18px' }).run()
 *   editor.chain().focus().setMark('textStyle', { fontSize: null }).run()
 * `sanitizeStaticPageHtml` allows `style` with a `font-size` declaration
 * on `span` already (see STYLE_VALIDATORS in lib/content/sanitize-html.ts),
 * so no sanitizer change was needed for this.
 */
import BaseTextStyle from '@tiptap/extension-text-style';

export const FontSizeExtension = BaseTextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.fontSize || null,
        renderHTML: (attributes: { fontSize?: string | null }) => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}` };
        },
      },
    };
  },
});
