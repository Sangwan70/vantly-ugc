// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Block, BlockAlign, BuilderState, Row, Selection, SocialPlatform, newId } from '@/lib/content/builder/types';
import { BuilderActions } from '@/lib/content/builder/useBuilderActions';
import { MiniButton, MiniInput, MiniSelect, MiniTextarea, DARK } from './ui';

const SOCIAL_PLATFORM_OPTIONS: { value: SocialPlatform; label: string }[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'website', label: 'Website' },
];

const COLUMN_WIDTH_PRESETS: Record<2 | 3, number[][]> = {
  2: [[50, 50], [30, 70], [70, 30], [25, 75], [75, 25]],
  3: [[33.34, 33.33, 33.33], [50, 25, 25], [25, 50, 25], [25, 25, 50]],
};

function findBlock(state: BuilderState, blockId: string): Block | null {
  for (const row of state.rows) {
    for (const col of row.columns) {
      const block = col.blocks.find((b) => b.id === blockId);
      if (block) return block;
    }
  }
  return null;
}

function findRow(state: BuilderState, rowId: string): Row | null {
  return state.rows.find((r) => r.id === rowId) || null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[11px]" style={{ color: DARK.textMuted }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function AlignField({ value, onChange }: { value: BlockAlign; onChange: (v: BlockAlign) => void }) {
  const opts: BlockAlign[] = ['left', 'center', 'right'];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <MiniButton key={o} active={value === o} className="flex-1 capitalize" onClick={() => onChange(o)}>
          {o}
        </MiniButton>
      ))}
    </div>
  );
}

function ColorField({ value, onChange, allowClear }: { value: string; onChange: (v: string) => void; allowClear?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 rounded border"
        style={{ borderColor: DARK.inputBorder, background: 'transparent' }}
      />
      <MiniInput value={value} placeholder={allowClear ? 'inherit' : '#000000'} onChange={(e) => onChange(e.target.value)} />
      {allowClear && value && (
        <MiniButton onClick={() => onChange('')}>Clear</MiniButton>
      )}
    </div>
  );
}

export function InspectorPanel({ state, selection, actions }: { state: BuilderState; selection: Selection; actions: BuilderActions }) {
  if (!selection) {
    return (
      <div className="p-4 text-xs" style={{ color: DARK.textMuted }}>
        Select a row or block to see its settings here.
      </div>
    );
  }

  if (selection.kind === 'row') {
    const row = findRow(state, selection.rowId);
    if (!row) return null;
    return (
      <div className="space-y-4 p-3">
        <h3 className="text-[11px] font-semibold uppercase" style={{ color: DARK.textMuted }}>
          Row settings
        </h3>
        <Field label="Columns">
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((n) => (
              <MiniButton key={n} active={row.columns.length === n} className="flex-1" onClick={() => actions.setRowColumnCount(row.id, n)}>
                {n}
              </MiniButton>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: DARK.textMuted }}>
            Reducing columns moves their blocks into the last remaining column -- nothing is deleted.
          </p>
        </Field>
        {row.columns.length > 1 && (
          <Field label="Column widths (%)">
            <div className="space-y-1.5">
              {row.columns.map((col, i) => (
                <div key={col.id} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-[10px]" style={{ color: DARK.textMuted }}>{i + 1}</span>
                  <MiniInput
                    type="number"
                    min={10}
                    max={90}
                    value={Math.round(col.widthPercent * 10) / 10}
                    onChange={(e) => {
                      const widths = row.columns.map((c) => c.widthPercent);
                      widths[i] = Number(e.target.value) || 0;
                      actions.setColumnWidths(row.id, widths);
                    }}
                  />
                  <span className="text-[10px]" style={{ color: DARK.textMuted }}>%</span>
                </div>
              ))}
              <p className="text-[10px]" style={{ color: DARK.textMuted }}>
                Total: {Math.round(row.columns.reduce((sum, c) => sum + c.widthPercent, 0) * 10) / 10}% -- doesn&apos;t
                need to be exactly 100. Or drag the divider between columns directly on the canvas.
              </p>
              <div className="flex flex-wrap gap-1">
                {(COLUMN_WIDTH_PRESETS[row.columns.length as 2 | 3] || []).map((preset, idx) => (
                  <MiniButton key={idx} onClick={() => actions.setColumnWidths(row.id, preset)}>
                    {preset.map((p) => Math.round(p)).join(' / ')}
                  </MiniButton>
                ))}
              </div>
            </div>
          </Field>
        )}
        <Field label="Background color">
          <ColorField value={row.bgColor} onChange={(bgColor) => actions.updateRow(row.id, { bgColor })} allowClear />
        </Field>
        <Field label="Vertical padding (px)">
          <MiniInput type="number" min={0} value={row.paddingY} onChange={(e) => actions.updateRow(row.id, { paddingY: Number(e.target.value) || 0 })} />
        </Field>
      </div>
    );
  }

  const block = findBlock(state, selection.blockId);
  if (!block) return null;

  return (
    <div className="space-y-4 p-3">
      <h3 className="text-[11px] font-semibold uppercase" style={{ color: DARK.textMuted }}>
        {block.type} block settings
      </h3>

      {block.type === 'text' && (
        <>
          <Field label="Alignment">
            <AlignField value={block.align} onChange={(align) => actions.updateBlock(block.id, { align })} />
          </Field>
          <Field label="Text color">
            <ColorField value={block.textColor} onChange={(textColor) => actions.updateBlock(block.id, { textColor })} allowClear />
          </Field>
        </>
      )}

      {block.type === 'image' && (
        <>
          <Field label="Width (px)">
            <div className="flex gap-2">
              <MiniInput type="number" min={0} value={block.width} onChange={(e) => actions.updateBlock(block.id, { width: Number(e.target.value) || 0 })} />
              <MiniButton className="whitespace-nowrap" onClick={() => actions.updateBlock(block.id, { width: 0 })}>
                Full width
              </MiniButton>
            </div>
            <p className="text-[10px]" style={{ color: DARK.textMuted }}>0 = fills the column. Or drag the handle on the image.</p>
          </Field>
          <Field label="Alignment">
            <AlignField value={block.align} onChange={(align) => actions.updateBlock(block.id, { align })} />
          </Field>
          <Field label="Alt text">
            <MiniInput value={block.alt} onChange={(e) => actions.updateBlock(block.id, { alt: e.target.value })} />
          </Field>
          <Field label="Link URL (optional)">
            <MiniInput value={block.link} placeholder="https://..." onChange={(e) => actions.updateBlock(block.id, { link: e.target.value })} />
          </Field>
        </>
      )}

      {block.type === 'button' && (
        <>
          <Field label="Label">
            <MiniInput value={block.label} onChange={(e) => actions.updateBlock(block.id, { label: e.target.value })} />
          </Field>
          <Field label="URL">
            <MiniInput value={block.url} placeholder="https://..." onChange={(e) => actions.updateBlock(block.id, { url: e.target.value })} />
          </Field>
          <Field label="Alignment">
            <AlignField value={block.align} onChange={(align) => actions.updateBlock(block.id, { align })} />
          </Field>
          <Field label="Background color">
            <ColorField value={block.bgColor} onChange={(bgColor) => actions.updateBlock(block.id, { bgColor })} />
          </Field>
          <Field label="Text color">
            <ColorField value={block.textColor} onChange={(textColor) => actions.updateBlock(block.id, { textColor })} />
          </Field>
          <Field label="Corner radius (px)">
            <MiniInput type="number" min={0} value={block.borderRadius} onChange={(e) => actions.updateBlock(block.id, { borderRadius: Number(e.target.value) || 0 })} />
          </Field>
        </>
      )}

      {block.type === 'divider' && (
        <>
          <Field label="Color">
            <ColorField value={block.color} onChange={(color) => actions.updateBlock(block.id, { color })} />
          </Field>
          <Field label="Thickness (px)">
            <MiniInput type="number" min={1} value={block.thickness} onChange={(e) => actions.updateBlock(block.id, { thickness: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Spacing above/below (px)">
            <MiniInput type="number" min={0} value={block.spacing} onChange={(e) => actions.updateBlock(block.id, { spacing: Number(e.target.value) || 0 })} />
          </Field>
        </>
      )}

      {block.type === 'spacer' && (
        <Field label="Height (px)">
          <MiniInput type="number" min={1} value={block.height} onChange={(e) => actions.updateBlock(block.id, { height: Number(e.target.value) || 1 })} />
        </Field>
      )}

      {block.type === 'quote' && (
        <>
          <Field label="Quote">
            <MiniTextarea rows={4} value={block.quote} onChange={(e) => actions.updateBlock(block.id, { quote: e.target.value })} />
          </Field>
          <Field label="Attribution">
            <MiniInput value={block.attribution} placeholder="Jane Doe, Head of Marketing" onChange={(e) => actions.updateBlock(block.id, { attribution: e.target.value })} />
          </Field>
          <Field label="Alignment">
            <AlignField value={block.align} onChange={(align) => actions.updateBlock(block.id, { align })} />
          </Field>
          <Field label="Accent color">
            <ColorField value={block.accentColor} onChange={(accentColor) => actions.updateBlock(block.id, { accentColor })} />
          </Field>
        </>
      )}

      {block.type === 'social' && (
        <>
          <Field label="Links">
            <div className="space-y-2">
              {block.links.map((link, i) => (
                <div key={link.id} className="flex items-center gap-1.5">
                  <MiniSelect
                    value={link.platform}
                    onChange={(v) => {
                      const links = block.links.map((l, idx) => (idx === i ? { ...l, platform: v as SocialPlatform } : l));
                      actions.updateBlock(block.id, { links });
                    }}
                    options={SOCIAL_PLATFORM_OPTIONS}
                    className="w-[110px] shrink-0"
                  />
                  <MiniInput
                    value={link.url}
                    placeholder="https://..."
                    onChange={(e) => {
                      const links = block.links.map((l, idx) => (idx === i ? { ...l, url: e.target.value } : l));
                      actions.updateBlock(block.id, { links });
                    }}
                  />
                  {block.links.length > 1 && (
                    <button
                      type="button"
                      className="shrink-0 rounded border p-1.5 hover:bg-red-500/10"
                      style={{ borderColor: DARK.inputBorder }}
                      title="Remove link"
                      onClick={() => {
                        const links = block.links.filter((_, idx) => idx !== i);
                        actions.updateBlock(block.id, { links });
                      }}
                    >
                      <Trash2 className="h-3 w-3" style={{ color: DARK.danger }} />
                    </button>
                  )}
                </div>
              ))}
              {block.links.length < 6 && (
                <MiniButton
                  className="gap-1"
                  onClick={() => {
                    const links = [...block.links, { id: newId(), platform: 'website' as SocialPlatform, url: 'https://' }];
                    actions.updateBlock(block.id, { links });
                  }}
                >
                  <Plus className="h-3 w-3" /> Add link
                </MiniButton>
              )}
            </div>
          </Field>
          <Field label="Alignment">
            <AlignField value={block.align} onChange={(align) => actions.updateBlock(block.id, { align })} />
          </Field>
          <Field label="Badge color">
            <ColorField value={block.badgeColor} onChange={(badgeColor) => actions.updateBlock(block.id, { badgeColor })} />
          </Field>
        </>
      )}

      {block.type === 'stats' && (
        <>
          <Field label="Stats">
            <div className="space-y-2">
              {block.items.map((item, i) => (
                <div key={item.id} className="flex items-center gap-1.5">
                  <MiniInput
                    value={item.value}
                    placeholder="500+"
                    className="w-20 shrink-0"
                    onChange={(e) => {
                      const items = block.items.map((it, idx) => (idx === i ? { ...it, value: e.target.value } : it));
                      actions.updateBlock(block.id, { items });
                    }}
                  />
                  <MiniInput
                    value={item.label}
                    placeholder="Creators"
                    onChange={(e) => {
                      const items = block.items.map((it, idx) => (idx === i ? { ...it, label: e.target.value } : it));
                      actions.updateBlock(block.id, { items });
                    }}
                  />
                  {block.items.length > 2 && (
                    <button
                      type="button"
                      className="shrink-0 rounded border p-1.5 hover:bg-red-500/10"
                      style={{ borderColor: DARK.inputBorder }}
                      title="Remove stat"
                      onClick={() => {
                        const items = block.items.filter((_, idx) => idx !== i);
                        actions.updateBlock(block.id, { items });
                      }}
                    >
                      <Trash2 className="h-3 w-3" style={{ color: DARK.danger }} />
                    </button>
                  )}
                </div>
              ))}
              {block.items.length < 4 && (
                <MiniButton
                  className="gap-1"
                  onClick={() => {
                    const items = [...block.items, { id: newId(), value: '0', label: 'Label' }];
                    actions.updateBlock(block.id, { items });
                  }}
                >
                  <Plus className="h-3 w-3" /> Add stat
                </MiniButton>
              )}
            </div>
          </Field>
          <Field label="Accent color">
            <ColorField value={block.accentColor} onChange={(accentColor) => actions.updateBlock(block.id, { accentColor })} />
          </Field>
        </>
      )}

      {block.type === 'raw' && (
        <p className="text-xs" style={{ color: DARK.textMuted }}>
          Edit this block&apos;s markup directly in the canvas -- it&apos;s selected there now.
        </p>
      )}

      <div className="border-t pt-3" style={{ borderColor: DARK.inputBorder }}>
        <MiniButton className="w-full" onClick={() => actions.deleteBlock(block.id)}>
          <span style={{ color: DARK.danger }}>Delete block</span>
        </MiniButton>
      </div>
    </div>
  );
}
