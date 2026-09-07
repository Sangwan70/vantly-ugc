// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * A minimal TipTap node for embedding a <video><source></video> element,
 * used by the Blog admin editor's "Generate from generated content"
 * feature (see .../dashboard/admin/blog/page.tsx and
 * services/api-v2/.../blog-assist.ts) to embed the source video inline in
 * an AI-drafted post.
 *
 * Without this, TipTap's schema (StarterKit + the handful of extensions
 * InlineTextEditor registers) has no node type for <video> at all, so
 * loading AI-drafted content_html into the Visual editor via
 * editor.commands.setContent()/the initial `content:` option would parse
 * the tag as unrecognized and drop it -- exactly like ResizableImageExtension
 * exists so <img width="..."> round-trips through TipTap instead of losing
 * its width. This is the same shape, hand-rolled instead of extending an
 * official @tiptap/extension-video package: no such dependency exists in
 * this workspace, and installing a new one currently fails with
 * ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF (see sanitize-html.ts's doc comment).
 *
 * Deliberately narrow: two attributes only (src, poster), matching exactly
 * what lib/content/sanitize-html.ts's blog allowlist (video: controls/
 * preload/playsinline/poster/style; source: src) keeps on save -- there is
 * no toolbar button to insert one by hand, this only needs to *preserve* a
 * video tag the AI-draft endpoint already generated.
 */
import { Node, mergeAttributes } from '@tiptap/core';

export interface VideoOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const VideoExtension = Node.create<VideoOptions>({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: null },
      poster: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video',
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const el = node;
          const src = el.querySelector('source')?.getAttribute('src') || el.getAttribute('src');
          if (!src) return false;
          return { src, poster: el.getAttribute('poster') || null };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, poster, ...rest } = HTMLAttributes as { src?: string; poster?: string | null };
    return [
      'video',
      mergeAttributes(this.options.HTMLAttributes, rest, {
        controls: '',
        playsinline: '',
        preload: 'metadata',
        style: 'width:100%;border-radius:12px;background-color:#000',
        ...(poster ? { poster } : {}),
      }),
      ['source', { src }],
    ];
  },
});
