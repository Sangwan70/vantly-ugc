// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Video Generation Flow audit improvement #10 ("paste a URL, get a
// drafted ad"). Pure-module level, same convention as the other Milestone
// 2 tests -- buildPitchFromBrand takes plain brand-kit data in, no
// server/network/DB import (it never calls brand-extractor or Anthropic
// itself; draftScriptFromUrlRoute wires those in separately).

import { describe, it, expect } from 'vitest';
import { buildPitchFromBrand } from '../routes/v1/assist.js';

function brand(overrides: Partial<Parameters<typeof buildPitchFromBrand>[0]> = {}) {
  return { brand_name: null, title: null, description: null, hero: null, ...overrides };
}

describe('buildPitchFromBrand', () => {
  it('prefers brand_name + description', () => {
    expect(
      buildPitchFromBrand(
        brand({ brand_name: 'Acme Kettles', title: 'Home | Acme', description: 'Stovetop kettles that whistle a tune.', hero: 'Boil smarter' }),
      ),
    ).toBe('Acme Kettles: Stovetop kettles that whistle a tune.');
  });

  it('falls back to title when brand_name is missing', () => {
    expect(buildPitchFromBrand(brand({ title: 'Acme Kettles', description: 'Stovetop kettles.' }))).toBe(
      'Acme Kettles: Stovetop kettles.',
    );
  });

  it('falls back to hero text when description is missing', () => {
    expect(buildPitchFromBrand(brand({ brand_name: 'Acme Kettles', hero: 'Boil smarter, not harder.' }))).toBe(
      'Acme Kettles: Boil smarter, not harder.',
    );
  });

  it('uses just the name when there is no description or hero', () => {
    expect(buildPitchFromBrand(brand({ brand_name: 'Acme Kettles' }))).toBe('Acme Kettles');
  });

  it('uses just the detail when there is no name at all', () => {
    expect(buildPitchFromBrand(brand({ description: 'Stovetop kettles that whistle a tune.' }))).toBe(
      'Stovetop kettles that whistle a tune.',
    );
  });

  it('returns null when nothing usable was extracted', () => {
    expect(buildPitchFromBrand(brand())).toBeNull();
    expect(buildPitchFromBrand(brand({ brand_name: '   ', description: '' }))).toBeNull();
  });

  it('caps the synthesized pitch at 400 chars (matching DraftScriptRequestSchema.pitch)', () => {
    const longDescription = 'x'.repeat(600);
    const pitch = buildPitchFromBrand(brand({ brand_name: 'Acme', description: longDescription }));
    expect(pitch).not.toBeNull();
    expect(pitch!.length).toBe(400);
  });

  it('trims whitespace before joining', () => {
    expect(buildPitchFromBrand(brand({ brand_name: '  Acme Kettles  ', description: '  Stovetop kettles.  ' }))).toBe(
      'Acme Kettles: Stovetop kettles.',
    );
  });
});
