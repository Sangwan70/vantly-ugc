// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Minimal dark-theme UI primitives for the Content Builder, standing in
 * for the shadcn/Radix components AutoGPT's mailer builder uses
 * (Button/DropdownMenu/Select/Input/Label) -- this repo doesn't have a
 * Radix-based kit installed, and pulling one in just for this feature
 * isn't worth the extra dependency surface. Styled to match the existing
 * admin/content page's inline dark palette (CARD/INPUT constants) rather
 * than Tailwind's default light theme.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const DARK = {
  panelBg: '#14151F',
  panelBorder: 'rgba(255,255,255,0.08)',
  inputBg: '#0F1015',
  inputBorder: 'rgba(255,255,255,0.12)',
  text: '#E9E9F0',
  textMuted: 'rgba(255,255,255,0.5)',
  accent: '#A78BFA',
  accentText: '#191A22',
  danger: '#F87171',
};

export function MiniButton({
  active,
  variant = 'outline',
  size = 'sm',
  className,
  disabled,
  title,
  onClick,
  onMouseDown,
  children,
  type = 'button',
}: {
  active?: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'xs';
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  type?: 'button' | 'submit';
}) {
  const isDefault = variant === 'default' || active;
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-md border text-xs transition-colors disabled:opacity-40',
        size === 'xs' ? 'h-6 w-6 p-0' : 'h-7 px-2',
        className,
      )}
      style={{
        background: isDefault ? DARK.accent : variant === 'ghost' ? 'transparent' : '#1B1C2A',
        color: isDefault ? DARK.accentText : DARK.text,
        borderColor: isDefault ? DARK.accent : DARK.inputBorder,
      }}
    >
      {children}
    </button>
  );
}

export function MiniInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, style, ...rest } = props;
  return (
    <input
      {...rest}
      className={cn('h-7 w-full rounded-md px-2 text-xs outline-none', className)}
      style={{ background: DARK.inputBg, color: DARK.text, border: `1px solid ${DARK.inputBorder}`, ...style }}
    />
  );
}

export function MiniTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, style, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn('w-full rounded-md p-2 text-xs outline-none', className)}
      style={{ background: DARK.inputBg, color: DARK.text, border: `1px solid ${DARK.inputBorder}`, ...style }}
    />
  );
}

export function MiniLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px]" style={{ color: DARK.textMuted }}>{children}</label>;
}

export function MiniSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-7 rounded-md px-1.5 text-xs outline-none', className)}
      style={{ background: DARK.inputBg, color: DARK.text, border: `1px solid ${DARK.inputBorder}` }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** A simple click-to-toggle dropdown menu -- closes on outside click or
 * Escape. Stands in for Radix DropdownMenu (trigger + floating panel)
 * without the extra dependency. */
export function MiniDropdown({
  trigger,
  children,
  align = 'start',
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div
          className={cn('absolute top-full z-50 mt-1 min-w-[180px] rounded-lg p-1 shadow-xl', align === 'end' ? 'right-0' : 'left-0')}
          style={{ background: '#1B1C2A', border: `1px solid ${DARK.inputBorder}` }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MiniDropdownItem({
  onSelect,
  className,
  children,
}: {
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="menuitem"
      onClick={onSelect}
      className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/5', className)}
      style={{ color: DARK.text }}
    >
      {children}
    </div>
  );
}
