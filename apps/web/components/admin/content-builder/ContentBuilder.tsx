// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Code2, LayoutGrid, Monitor, Palette, Smartphone } from 'lucide-react';
import { BuilderState, Selection } from '@/lib/content/builder/types';
import { deserializeBuilderState, serializeBuilderState } from '@/lib/content/builder/serialize';
import { useBuilderActions } from '@/lib/content/builder/useBuilderActions';
import { THEME_PRESETS } from '@/lib/content/builder/themes';
import { Canvas } from './Canvas';
import { InspectorPanel } from './InspectorPanel';
import { MiniButton, MiniDropdown, MiniDropdownItem, MiniTextarea, DARK } from './ui';

const DEVICE_WIDTH = { desktop: 720, mobile: 375 } as const;

/**
 * Drag-and-drop visual page builder for admin Content Management --
 * ported from AutoGPT's Mailer template visual builder (rows -> columns
 * -> Text/Image/Button/Divider/Spacer/Quote/Social/Stats blocks, drag
 * reordering, column resize, themes, reusable saved blocks, Source Code
 * fallback). Same drop-in contract as the textarea it replaces
 * (`value`/`onChange` of the final HTML string) -- nothing downstream
 * (the public pricing/privacy/terms pages, the sanitizer) needed to
 * change: this is purely a friendlier way to produce the same
 * `static_pages.content_html` string that a raw-HTML textarea always
 * produced. See lib/content/builder/serialize.ts for exactly what HTML
 * shape each block renders as (flexbox, not `<table>` -- this targets a
 * browser page, not an email client).
 */
export function ContentBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const [builderState, setBuilderState] = useState<BuilderState>(() => deserializeBuilderState(value).state);
  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [selection, setSelection] = useState<Selection>(null);
  const [sourceText, setSourceText] = useState(value);
  const lastEmittedRef = useRef(value);

  const actions = useBuilderActions(setBuilderState, setSelection);

  useEffect(() => {
    if (mode !== 'visual') return;
    const html = serializeBuilderState(builderState);
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  }, [builderState, mode]);

  // External value changes (e.g. switching which page/slug is open in the
  // edit dialog) rehydrate the builder, same guard pattern as the old
  // textarea used to avoid fighting the admin's own typing.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setSourceText(value);
    if (mode === 'visual') {
      setBuilderState(deserializeBuilderState(value).state);
    }
  }, [value]);

  function handleSourceChange(text: string) {
    setSourceText(text);
    lastEmittedRef.current = text;
    onChange(text);
  }

  function switchToSource() {
    setSourceText(serializeBuilderState(builderState));
    setMode('source');
  }

  function switchToVisual() {
    setBuilderState(deserializeBuilderState(sourceText).state);
    setSelection(null);
    setMode('visual');
  }

  return (
    <div className="rounded-lg" style={{ border: `1px solid ${DARK.inputBorder}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 p-2" style={{ background: '#0F1015', borderBottom: `1px solid ${DARK.inputBorder}` }}>
        <div className="flex gap-1">
          <MiniButton active={mode === 'visual'} className="gap-1.5" onClick={switchToVisual}>
            <LayoutGrid className="h-3.5 w-3.5" />
            Visual
          </MiniButton>
          <MiniButton active={mode === 'source'} className="gap-1.5" onClick={switchToSource}>
            <Code2 className="h-3.5 w-3.5" />
            Source Code
          </MiniButton>
        </div>

        {mode === 'visual' && (
          <div className="flex gap-1">
            <MiniDropdown
              trigger={
                <MiniButton className="gap-1.5">
                  <Palette className="h-3.5 w-3.5" />
                  Theme
                </MiniButton>
              }
            >
              {(close) => (
                <>
                  {THEME_PRESETS.map((theme) => (
                    <MiniDropdownItem
                      key={theme.id}
                      onSelect={() => {
                        actions.applyTheme(theme);
                        close();
                      }}
                    >
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border" style={{ backgroundColor: theme.accent, borderColor: DARK.inputBorder }} />
                      {theme.name}
                    </MiniDropdownItem>
                  ))}
                </>
              )}
            </MiniDropdown>
            <MiniButton active={device === 'desktop'} className="gap-1.5" title="Desktop preview width" onClick={() => setDevice('desktop')}>
              <Monitor className="h-3.5 w-3.5" />
              Desktop
            </MiniButton>
            <MiniButton active={device === 'mobile'} className="gap-1.5" title="Mobile preview width" onClick={() => setDevice('mobile')}>
              <Smartphone className="h-3.5 w-3.5" />
              Mobile
            </MiniButton>
          </div>
        )}
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
            h1-h6, blockquote, code, pre, img, figure/figcaption, span/div -- plus a scoped inline-style
            property list). Switching back to Visual wraps this as a single editable &quot;Raw HTML&quot; block.
          </p>
        </div>
      ) : (
        <div className="flex">
          <div className="flex-1 overflow-x-auto p-4" style={{ background: '#191A22' }} onClick={() => setSelection(null)}>
            <Canvas state={builderState} actions={actions} selection={selection} onSelect={setSelection} canvasWidth={DEVICE_WIDTH[device]} />
          </div>
          <div className="w-64 shrink-0" style={{ borderLeft: `1px solid ${DARK.inputBorder}`, background: '#14151F' }}>
            <InspectorPanel state={builderState} selection={selection} actions={actions} />
          </div>
        </div>
      )}
    </div>
  );
}
