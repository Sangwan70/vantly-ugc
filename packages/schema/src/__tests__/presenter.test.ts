// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Presenter takes: billed seconds, cache key and staleness must agree across the
// editor, api-v2 and the render, or a user pays twice for the same clip.

import { describe, expect, it } from 'vitest';
import {
  VoiceBlockSchema,
  VoiceoverPresenterSchema,
  VoiceoverTimelineSchema,
  presenterBlockProblem,
  presenterClipFor,
  presenterCorner,
  presenterFrame,
  presenterTakeKey,
  presenterTakeSeconds,
  quotePresenterCredits,
} from '../voiceover.js';

const look = VoiceoverPresenterSchema.parse({ photo_url: 'https://cdn.example.com/me.jpg', consent: true });
const block = (over: Record<string, unknown> = {}) =>
  VoiceBlockSchema.parse({ id: 'v1', start: 2, text: 'Hello', audio_url: 'https://cdn.example.com/a.mp3', audio_duration: 7.99, take_id: '2841a611-7793-4824-941e-13660d2fcad4', ...over });

describe('presenter pricing', () => {
  it('bills the played audio rounded up, within 4–15 s', () => {
    expect(presenterTakeSeconds(7.998)).toBe(8);
    expect(presenterTakeSeconds(8)).toBe(8);
    expect(presenterTakeSeconds(2.1)).toBe(4);
    expect(presenterTakeSeconds(14.2)).toBe(15);
    expect(quotePresenterCredits(7.998)).toBe(8 * 31);
  });
});

describe('presenter cache', () => {
  it('old projects load without presenter data', () => {
    const tl = VoiceoverTimelineSchema.parse({ blocks: [{ id: 'v1', start: 0 }] });
    expect(tl.blocks[0].presenter).toBeUndefined();
    expect(tl.presenter.photo_url).toBeNull();
  });

  it('a clip is reused only for the same take, trim, photo and setting', () => {
    const b = block();
    const key = presenterTakeKey(b, look)!;
    const on = block({ presenter: { on: true, clip_url: 'https://cdn.example.com/p.mp4', clip_key: key } });
    expect(presenterClipFor(on, look)).toBe('https://cdn.example.com/p.mp4');
    expect(presenterClipFor({ ...on, take_id: 'c0b1d1c4-0000-4000-8000-000000000000' }, look)).toBeNull();
    expect(presenterClipFor({ ...on, audio_out: 5 }, look)).toBeNull();
    expect(presenterClipFor(on, { ...look, photo_url: 'https://cdn.example.com/new.jpg' })).toBeNull();
    expect(presenterClipFor(on, { ...look, scene: 'a bright office' })).toBeNull();
    expect(presenterClipFor({ ...on, presenter: { ...on.presenter!, on: false } }, look)).toBeNull();
  });

  it('explains what blocks a take', () => {
    expect(presenterBlockProblem(block(), { ...look, photo_url: null })).toMatch(/photo/);
    expect(presenterBlockProblem(block(), { ...look, consent: false })).toMatch(/consent/);
    expect(presenterBlockProblem(block({ audio_url: null }), look)).toMatch(/voice/);
    expect(presenterBlockProblem(block({ audio_duration: 16 }), look)).toMatch(/split/);
    expect(presenterBlockProblem(block(), look)).toBeNull();
  });

  it('auto corner keeps clear of the logo', () => {
    expect(presenterCorner({ corner: 'auto' }, 'tr')).toBe('br');
    expect(presenterCorner({ corner: 'auto' }, 'br')).toBe('bl');
    expect(presenterCorner({ corner: 'tl' }, 'br')).toBe('tl');
  });
});

describe('presenter frame', () => {
  const tl = VoiceoverTimelineSchema.parse({
    clips: [{ id: 'q', kind: 'card', card: { title: 'Question', duration: 6 } }, { id: 'c1', src_in: 0, src_out: 20 }],
    output: { aspect: '16:9' },
  });
  it('is full frame on a title card and the circle over the recording', () => {
    expect(presenterFrame(tl, { start: 0.3 })).toBe('16:9');
    expect(presenterFrame(tl, { start: 8 })).toBe('1:1');
  });
  it('a full-frame take is cached separately from a circle take', () => {
    const b = block();
    expect(presenterTakeKey(b, look, '16:9')).not.toBe(presenterTakeKey(b, look));
    expect(presenterTakeKey(b, look, '1:1')).toBe(presenterTakeKey(b, look));
  });
});
