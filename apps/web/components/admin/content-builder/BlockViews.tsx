// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Block,
  BlockAlign,
  ButtonBlock,
  DividerBlock,
  ImageBlock,
  QuoteBlock,
  RawHtmlBlock,
  SocialIconsBlock,
  SocialPlatform,
  SpacerBlock,
  StatsBlock,
  TextBlock,
} from '@/lib/content/builder/types';
import { InlineTextEditor } from './InlineTextEditor';
import { MiniButton, MiniTextarea, DARK } from './ui';

const MAX_IMAGE_SIZE_MB = 8; // matches /api/admin/content/media's own cap
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

async function uploadContentImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/admin/content/media', { method: 'POST', credentials: 'include', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`);
  return j.url as string;
}

interface ViewProps<T extends Block> {
  block: T;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<T>) => void;
  /** Roughly how wide this block's column renders in the canvas at
   * current preview width -- used to clamp image resize/width defaults
   * so "100%" always means something sensible. */
  columnWidthPx: number;
}

function AlignButtons({ align, onChange }: { align: BlockAlign; onChange: (align: BlockAlign) => void }) {
  const options: { value: BlockAlign; icon: React.ReactNode; title: string }[] = [
    { value: 'left', icon: <AlignLeft className="h-3.5 w-3.5" />, title: 'Align left' },
    { value: 'center', icon: <AlignCenter className="h-3.5 w-3.5" />, title: 'Align center' },
    { value: 'right', icon: <AlignRight className="h-3.5 w-3.5" />, title: 'Align right' },
  ];
  return (
    <div className="flex gap-0.5" onMouseDown={(e) => e.stopPropagation()}>
      {options.map((o) => (
        <MiniButton key={o.value} size="xs" active={align === o.value} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon}
        </MiniButton>
      ))}
    </div>
  );
}

export function TextBlockView({ block, onChange }: ViewProps<TextBlock>) {
  return (
    <div style={{ textAlign: block.align, color: block.textColor || undefined }} className="rounded">
      <InlineTextEditor value={block.html} onChange={(html) => onChange({ html })} />
    </div>
  );
}

export function ImageBlockView({ block, onChange, selected, columnWidthPx }: ViewProps<ImageBlock>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  const maxWidth = Math.max(columnWidthPx, 80);
  const effectiveWidth = liveWidth ?? (block.width || columnWidthPx);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      setUploadError(`Max upload size is ${MAX_IMAGE_SIZE_MB}MB.`);
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const url = await uploadContentImage(file);
      onChange({ src: url, alt: block.alt || file.name });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload image.');
    } finally {
      setIsUploading(false);
    }
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizingRef.current = { startX: e.clientX, startWidth: block.width || columnWidthPx };
  }

  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return;
    const delta = e.clientX - resizingRef.current.startX;
    const next = Math.min(maxWidth, Math.max(40, Math.round(resizingRef.current.startWidth + delta)));
    setLiveWidth(next);
  }

  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    resizingRef.current = null;
    if (liveWidth != null) {
      onChange({ width: liveWidth });
      setLiveWidth(null);
    }
  }

  if (!block.src) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-xs"
        style={{ borderColor: DARK.inputBorder, color: DARK.textMuted }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ImagePlus className="h-6 w-6" />
        <MiniButton disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Upload image'}
        </MiniButton>
        {uploadError && <p style={{ color: DARK.danger }}>{uploadError}</p>}
        <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={handleFileSelected} />
      </div>
    );
  }

  const justify = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start';

  return (
    <div>
      {selected && (
        <div className="mb-1 flex items-center justify-between" onMouseDown={(e) => e.stopPropagation()}>
          <AlignButtons align={block.align} onChange={(align) => onChange({ align })} />
          <MiniButton disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
            Replace
          </MiniButton>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={handleFileSelected} />
        </div>
      )}
      {uploadError && (
        <p className="mb-1 text-[11px]" style={{ color: DARK.danger }}>
          {uploadError}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: justify }}>
        <div className="relative inline-block" style={{ width: effectiveWidth }}>
          {block.link ? (
            <div className="pointer-events-none absolute -top-2 left-0 rounded px-1 text-[10px] text-white" style={{ background: DARK.accent, color: DARK.accentText }}>
              linked
            </div>
          ) : null}
          <img
            src={block.src}
            alt={block.alt}
            width={effectiveWidth}
            className={cn('block w-full select-none rounded-sm', selected && 'ring-2 ring-violet-400')}
            draggable={false}
          />
          {selected && (
            <div
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-ew-resize rounded-sm border shadow"
              style={{ background: DARK.accent, borderColor: '#fff' }}
              onPointerDown={startResize}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              title="Drag to resize"
            />
          )}
          {selected && (
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: '#000' }}>
              {Math.round(effectiveWidth)}px
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ButtonBlockView({ block, selected }: ViewProps<ButtonBlock>) {
  const justify = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div style={{ display: 'flex', justifyContent: justify }}>
      <span
        className={cn('inline-block select-none rounded px-6 py-2.5 text-sm font-semibold', selected && 'ring-2 ring-violet-400')}
        style={{ backgroundColor: block.bgColor, color: block.textColor, borderRadius: block.borderRadius }}
      >
        {block.label || 'Button'}
      </span>
    </div>
  );
}

export function DividerBlockView({ block }: ViewProps<DividerBlock>) {
  return <div style={{ borderTop: `${block.thickness}px solid ${block.color}`, margin: `${block.spacing}px 0` }} />;
}

export function SpacerBlockView({ block, selected }: ViewProps<SpacerBlock>) {
  return (
    <div
      style={{
        height: block.height,
        borderColor: selected ? DARK.accent : DARK.inputBorder,
        color: DARK.textMuted,
      }}
      className="flex items-center justify-center rounded border border-dashed text-[10px]"
    >
      Spacer · {block.height}px
    </div>
  );
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'f',
  instagram: 'IG',
  linkedin: 'in',
  twitter: 'X',
  youtube: 'YT',
  website: 'W',
};

export function QuoteBlockView({ block }: ViewProps<QuoteBlock>) {
  return (
    <div style={{ textAlign: block.align, borderLeft: `4px solid ${block.accentColor}`, paddingLeft: 16 }} className="py-1">
      <p className="whitespace-pre-line text-[15px] italic leading-relaxed" style={{ color: DARK.text }}>
        {block.quote || 'Quote text'}
      </p>
      <p className="mt-2 text-xs font-semibold" style={{ color: DARK.textMuted }}>
        &mdash; {block.attribution || 'Attribution'}
      </p>
    </div>
  );
}

export function SocialIconsBlockView({ block }: ViewProps<SocialIconsBlock>) {
  const justify = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div style={{ display: 'flex', justifyContent: justify, gap: 8 }}>
      {block.links.map((link) => (
        <span
          key={link.id}
          className="flex h-8 w-8 select-none items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: block.badgeColor }}
          title={link.url}
        >
          {PLATFORM_LABELS[link.platform]}
        </span>
      ))}
    </div>
  );
}

export function StatsBlockView({ block }: ViewProps<StatsBlock>) {
  return (
    <div style={{ display: 'flex' }}>
      {block.items.map((item) => (
        <div key={item.id} className="flex-1 px-1 text-center">
          <div className="text-2xl font-bold leading-tight" style={{ color: block.accentColor }}>
            {item.value || '0'}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: DARK.textMuted }}>
            {item.label || 'Label'}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RawHtmlBlockView({ block, selected, onChange }: ViewProps<RawHtmlBlock>) {
  if (!selected) {
    return (
      <div
        className="rounded border border-dashed p-1"
        style={{ borderColor: DARK.inputBorder }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  }
  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      <p className="mb-1 text-[10px] uppercase" style={{ color: DARK.textMuted }}>
        Raw HTML -- imported content or manually written markup
      </p>
      <MiniTextarea rows={6} className="font-mono" value={block.html} onChange={(e) => onChange({ html: e.target.value })} />
    </div>
  );
}
