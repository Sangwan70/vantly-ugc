// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Regression guard for the dispatchMakePodcast / resumeSkillRunRoute refactor
// (services/api-v2/src/routes/v1/skills.ts): buildMakePodcastWorkflowInput is
// the SINGLE shape-builder both a fresh dispatch and a resume now share, so a
// bug here would silently affect both paths identically. Locks in the exact
// field mapping (including the room passthrough and the subtitles/style
// defaults) so a future edit can't accidentally drop a field from one caller
// while keeping it for the other.
//
// server.js is mocked (not real env vars) so importing the route module in
// isolation doesn't require live Supabase config — same pattern as
// cancel-refund.test.ts.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../server.js', () => ({
  supabase: { from: vi.fn() },
}));

const { buildMakePodcastWorkflowInput } = await import('../routes/v1/skills.js');
type ResolvedPodcastCharacter = { ref_url: string; seed?: number };

const A: ResolvedPodcastCharacter = { ref_url: 'https://r2.example.com/a.png', seed: 42 };
const B: ResolvedPodcastCharacter = { ref_url: 'https://r2.example.com/b.png' };
const SCRIPT = [
  { speaker: 'A', line: 'Welcome back to the show.' },
  { speaker: 'B', line: 'Thanks for having me, excited to be here.' },
];

describe('buildMakePodcastWorkflowInput', () => {
  it('maps resolved identities + script into the workflow input shape', () => {
    const input = buildMakePodcastWorkflowInput(
      'user-1',
      'skill-run-1',
      { room: 'a cozy studio' },
      { a: A, b: B, script: SCRIPT },
    );
    expect(input).toEqual({
      skill_run_id: 'skill-run-1',
      user_id: 'user-1',
      character_a_ref_url: A.ref_url,
      character_a_seed: A.seed,
      character_b_ref_url: B.ref_url,
      character_b_seed: undefined,
      script: SCRIPT,
      room: 'a cozy studio',
      aspect_ratio: '9:16',
      subtitles: false,
      subtitles_style: 'hormozi',
    });
  });

  it('defaults subtitles/subtitles_style and passes them through when set', () => {
    const input = buildMakePodcastWorkflowInput(
      'user-1',
      'skill-run-2',
      { subtitles: true, subtitles_style: 'tiktok' },
      { a: A, b: B, script: SCRIPT },
    );
    expect(input.subtitles).toBe(true);
    expect(input.subtitles_style).toBe('tiktok');
  });

  it('always carries the SAME skill_run_id given to it — the whole point of resume', () => {
    // A fresh dispatch mints a new skill_run_id each call; a resume passes the
    // ORIGINAL one back in. This function must not derive its own — it has to
    // echo back whatever id the caller decided on, since that id is what makes
    // the workflow's deterministic child ids (and therefore the reuse of
    // already-succeeded steps) line up correctly.
    const input = buildMakePodcastWorkflowInput('user-1', 'the-original-run-id', {}, { a: A, b: B, script: SCRIPT });
    expect(input.skill_run_id).toBe('the-original-run-id');
  });
});
