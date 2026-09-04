// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Named color-theme presets for the "Apply Theme" toolbar action.
 *
 * Deliberately narrow in scope: applying a theme only rewrites the
 * *accent* colors used by Button/Divider/Quote/Social/Stats blocks
 * (`bgColor`/`color`/`accentColor`/`badgeColor` depending on block type)
 * -- it never touches row background colors or Text block colors, since
 * those are often deliberately customized per-row and silently
 * overwriting them on every theme click would be more surprising than
 * helpful. Buttons always get a high-contrast label color.
 */
export interface ThemePreset {
  id: string;
  name: string;
  /** Button background, quote/stats accent, social badge background. */
  accent: string;
  /** Divider line color -- deliberately more muted than the accent. */
  divider: string;
  /** Button label color -- always high-contrast against `accent`. */
  onAccent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'violet',
    name: 'Violet (brand)',
    accent: '#A78BFA',
    divider: 'rgba(167,139,250,0.35)',
    onAccent: '#191A22',
  },
  {
    id: 'blue',
    name: 'Blue',
    accent: '#60A5FA',
    divider: 'rgba(96,165,250,0.35)',
    onAccent: '#0B1220',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    accent: '#34D399',
    divider: 'rgba(52,211,153,0.35)',
    onAccent: '#0B1220',
  },
  {
    id: 'grey',
    name: 'Grey / Neutral',
    accent: '#9CA3AF',
    divider: 'rgba(255,255,255,0.12)',
    onAccent: '#191A22',
  },
];

export function findThemePreset(id: string): ThemePreset | null {
  return THEME_PRESETS.find((t) => t.id === id) || null;
}
