// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/** Shared style tokens for the admin Settings tabs — mirrors the tokens
 * already used by the admin dashboard (page.tsx, _ops-panels.tsx) so the
 * two admin sections look like one product. */
export const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
export const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
export const TEXT = '#E9E9F0';
export const MUTED = 'rgba(255,255,255,0.45)';
export const LABEL = 'rgba(255,255,255,0.4)';

export const inputClass =
  'h-10 w-full rounded-xl px-3 text-sm outline-none disabled:opacity-60';
export const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider';
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50';
export const primaryButtonStyle = { background: 'linear-gradient(90deg,#A78BFA,#7C3AED)', color: '#0F1015' } as const;
export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50';
export const secondaryButtonStyle = { background: '#1B1C2A', color: TEXT, border: '1px solid rgba(255,255,255,0.1)' } as const;
