// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { presenterLookPrompt } from '../activities/voiceover-presenter-look.js';

describe('presenter outfit prompt', () => {
  it('dresses the same face in the outfit, lips closed, in the setting', () => {
    const p = presenterLookPrompt('a navy blue suit, white shirt and tie.', 'a high-rise balcony with a city skyline');
    expect(p).toContain('wear a navy blue suit, white shirt and tie, neatly fitted');
    expect(p).toContain('exact face and identity');
    expect(p).toContain('closed-mouth smile');
    expect(p).toContain('Background: a high-rise balcony with a city skyline.');
  });
  it('falls back to a neutral office', () => {
    expect(presenterLookPrompt('a grey blazer', '')).toContain('bright modern office');
  });
});
