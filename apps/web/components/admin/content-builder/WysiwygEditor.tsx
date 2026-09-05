// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Code2, PenLine } from 'lucide-react';
import { InlineTextEditor } from './InlineTextEditor';
import { MiniButton, MiniTextarea, DARK } from './ui';

/**
 * Simple WYSIWYG editor for admin Content Management (static pages, blog
 * posts): rich text with inline image upload/resize via InlineTextEditor,
 * plus the same Visual/Source toggle UX ContentBuilder.tsx (the Mailer
 * Template builder) uses -- minus rows/columns/canvas.
 *
 * This replaces ContentBuilder as Content Management's editor. AutoGPT's
 * own Content Management uses exactly this shape -- StaticPageEditor's
 * "rich" mode is BlogPostEditor (TipTap + resizable inline images), not a
 * drag-and-drop block canvas. That canvas belongs to Mailer Templates
 * instead (see ContentBuilder.tsx's own doc comment) -- Content
 * Management pages are single flowing documents (a policy, a post body),
 * not multi-column marketing layouts.
 *
 * Same drop-in contract as ContentBuilder: `value`/`onChange` of the
 * final sanitized-on-save HTML string.
 */
export function WysiwygEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [sourceText, setSourceText] = useState(value);
  const lastEmittedRef = useRef(value);

  // External value changes (e.g. switching which page/post is open in the
  // edit dialog) rehydrate the source view, same guard ContentBuilder uses
  // to avoid fighting the admin's own typing.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setSourceText(value);
  }, [value]);

  function handleSourceChange(text: string) {
    setSourceText(text);
    lastEmittedRef.current = text;
    onChange(text);
  }

  function handleVisualChange(html: string) {
    lastEmittedRef.current = html;
    onChange(html);
  }

  return (
    <div className="rounded-lg" style={{ border: `1px solid ${DARK.inputBorder}` }}>
      <div className="flex items-center gap-1 p-2" style={{ background: '#0F1015', borderBottom: `1px solid ${DARK.inputBorder}` }}>
        <MiniButton active={mode === 'visual'} className="gap-1.5" onClick={() => setMode('visual')}>
          <PenLine className="h-3.5 w-3.5" />
          Visual
        </MiniButton>
        <MiniButton
          active={mode === 'source'}
          className="gap-1.5"
          onClick={() => {
            setSourceText(value);
            setMode('source');
          }}
        >
          <Code2 className="h-3.5 w-3.5" />
          Source Code
        </MiniButton>
      </div>

      {mode === 'source' ? (
        <div className="p-2">
          <MiniTextarea
            value={sourceText}
            onChange={(e) => handleSourceChange(e.target.value)}
            rows={16}
            className="font-mono"
            placeholder="<p>Write raw HTML here...</p>"
          />
          <p className="mt-1 text-[11px]" style={{ color: DARK.textMuted }}>
            Supports {'{{site_url}}'} and {'{{support_contact}}'} placeholders. Only tags/attributes
            lib/content/sanitize-html.ts allows survive an actual save (p, br, strong, em, a, ul/ol/li,
            h2-h4, blockquote, code, pre, img, span -- plus a scoped inline-style property list).
          </p>
        </div>
      ) : (
        <div className="p-2">
          <InlineTextEditor value={value} onChange={handleVisualChange} />
        </div>
      )}
    </div>
  );
}
