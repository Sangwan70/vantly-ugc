// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Small dark-dashboard primitives for the Studio (tokens from dashboard/layout.tsx). */

export const C = {
  bg: '#0F1015',
  side: '#0B0C11',
  card: '#14151F',
  hover: '#1B1C2A',
  line: 'rgba(255,255,255,0.06)',
  line2: 'rgba(255,255,255,0.12)',
  text: '#E9E9F0',
  muted: 'rgba(255,255,255,0.55)',
  faint: 'rgba(255,255,255,0.35)',
  accent: '#A78BFA',
};

export function Btn({ children, primary, small, disabled, onClick, title, type = 'button' }: {
  children: React.ReactNode;
  primary?: boolean;
  small?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-opacity disabled:opacity-40 ${small ? 'h-7 px-2 text-[11px]' : 'h-9 px-3 text-sm'}`}
      style={primary ? { background: C.accent, color: C.bg } : { background: 'transparent', color: C.text, border: `1px solid ${C.line2}` }}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>{label}{hint ? <span className="ml-1 normal-case tracking-normal">· {hint}</span> : null}</span>
      {children}
    </label>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-8 w-full min-w-0 rounded-lg px-2 text-xs outline-none ${props.className ?? ''}`}
      style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}`, ...props.style }}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 w-full min-w-0 rounded-lg px-2 text-xs outline-none ${props.className ?? ''}`}
      style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}`, ...props.style }}
    />
  );
}

export function Slider({ label, hint, min, max, step, value, onChange, fmt }: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex text-[11px]" style={{ color: C.muted }}>
        <span>{label}{hint ? <span style={{ color: C.faint }}> · {hint}</span> : null}</span>
        <span className="ml-auto font-mono" style={{ color: C.text }}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-violet-400" />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg p-0.5" style={{ background: C.bg, border: `1px solid ${C.line2}` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="flex-1 rounded-md px-2 py-1 text-[11px]"
          style={o.value === value ? { background: C.hover, color: C.text } : { color: C.muted }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
