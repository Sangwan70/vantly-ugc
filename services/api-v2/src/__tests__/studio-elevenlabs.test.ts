// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { alignmentToWords } from '../lib/elevenlabs.js';

describe('alignmentToWords (Voiceover Studio captions)', () => {
  it('folds character timings into words', () => {
    const text = 'Hi  there!';
    const chars = text.split('');
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.08);
    expect(alignmentToWords({ characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends })).toEqual([
      { word: 'Hi', start: 0, end: 0.18 },
      { word: 'there!', start: 0.4, end: expect.closeTo(0.98, 5) },
    ]);
  });
  it('drops eleven_v3 audio tags and handles missing alignment', () => {
    const chars = '[excited] Go'.split('');
    const t = chars.map((_, i) => i * 0.05);
    expect(alignmentToWords({ characters: chars, character_start_times_seconds: t, character_end_times_seconds: t }).map((w) => w.word)).toEqual(['Go']);
    expect(alignmentToWords(null)).toEqual([]);
  });
});
