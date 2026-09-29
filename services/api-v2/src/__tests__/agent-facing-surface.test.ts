// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// A7 + A10: the curated agent surface. When MAKE_UGC_ENABLED is on, the connector
// lists exactly the agentFacing vNext skills (make_ugc, make_podcast,
// make_storybook, make_subtitles, make_lip_sync) + create_character (the one V2
// tool that survives) + list_characters. This test pins the agentFacing set at
// the registry level so a stray agentFacing flag can't silently widen the
// surface -- widening it on purpose (as make_lip_sync's "Redub: New Dialogue"
// did) means updating this list deliberately, not just making the test pass.

import { describe, it, expect } from 'vitest';
import { SKILLS } from '../skills/registry.js';

describe('curated agent surface (A7/A10)', () => {
  it('exactly make_ugc, make_podcast, make_storybook, make_subtitles, make_lip_sync are agentFacing', () => {
    const facing = Object.values(SKILLS)
      .filter((s) => s.agentFacing === true)
      .map((s) => s.slug)
      .sort();
    expect(facing).toEqual(['make_lip_sync', 'make_podcast', 'make_storybook', 'make_subtitles', 'make_ugc']);
  });

  it('make_product_in_hands stays hidden (reached only via make_ugc Route 0)', () => {
    expect(SKILLS.make_product_in_hands.agentFacing).not.toBe(true);
  });
});
