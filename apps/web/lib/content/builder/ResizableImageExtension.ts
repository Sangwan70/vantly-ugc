// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Extends TipTap's Image node with a `width` attribute so the Text
 * block's toolbar can offer step-resize buttons (25/50/75/100%) for an
 * inline image -- matching AutoGPT's BlogPostEditor capability.
 *
 * Renders width as `style="width: N%"` rather than a plain `width="N%"`
 * HTML attribute: sanitizeStaticPageHtml's plain width/height attribute
 * validator is numeric-pixels-only (`/^\d{1,4}$/`, no "%"), so a percent
 * value can only survive through the `style` attribute -- the same
 * accommodation already made for the drag-and-drop Content Builder's
 * full-width block images (see the `img: [..., 'style']` entry in
 * ATTRS_BY_TAG). Diverges from AutoGPT's own plain-`width`-attribute
 * convention deliberately, for that reason.
 */
import BaseImage from '@tiptap/extension-image';

export const ResizableImageExtension = BaseImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '100%',
        parseHTML: (element: HTMLElement) => element.style.width || null,
        renderHTML: (attributes: { width?: string | null }) => {
          if (!attributes.width) return {};
          return { style: `width: ${attributes.width}` };
        },
      },
    };
  },
});
