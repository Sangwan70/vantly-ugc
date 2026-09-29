// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Regression guard for the Resume extension to make_ugc_video,
// make_broll_talking_head, and make_storybook (services/api-v2/src/routes/v1/skills.ts).
// Same reasoning as resume-podcast.test.ts: buildMakeUgcVideoWorkflowInput /
// buildBrollTalkingHeadWorkflowInput / buildMakeStorybookWorkflowInput are the
// SINGLE shape-builders shared by a fresh dispatch and a resume, so a bug here
// would silently affect both paths identically. Locks in the exact field
// mapping (including defaults) and, most importantly, that the caller-supplied
// skill_run_id is always echoed back unchanged — that's what makes a resumed
// run's deterministic child ids line up with whatever already succeeded.
//
// server.js is mocked (not real env vars) so importing the route module in
// isolation doesn't require live Supabase config — same pattern as
// cancel-refund.test.ts / resume-podcast.test.ts.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../server.js', () => ({
  supabase: { from: vi.fn() },
}));

const {
  buildMakeUgcVideoWorkflowInput,
  buildBrollTalkingHeadWorkflowInput,
  buildMakeStorybookWorkflowInput,
} = await import('../routes/v1/skills.js');

describe('buildMakeUgcVideoWorkflowInput', () => {
  const identity = { mode: 'portrait_url' as const, portrait_url: 'https://r2.example.com/portrait.png' };

  it('maps identity + body into the workflow input shape, with defaults applied', () => {
    const input = buildMakeUgcVideoWorkflowInput(
      'user-1',
      'skill-run-1',
      { character_description: 'a friendly barista', script: 'Hey, check this out.' },
      identity,
    );
    expect(input).toEqual({
      skill_run_id: 'skill-run-1',
      user_id: 'user-1',
      identity,
      character_description: 'a friendly barista',
      script: 'Hey, check this out.',
      duration: 10,
      location: undefined,
      pose: undefined,
      aspect_ratio: '9:16',
      subtitles: true,
      subtitles_style: 'hormozi',
      voice_ref_audio_url: undefined,
      watermark_text: undefined,
      language: undefined,
      background_music: undefined,
    });
  });

  it('passes explicit values through instead of the defaults', () => {
    const input = buildMakeUgcVideoWorkflowInput(
      'user-1',
      'skill-run-2',
      { duration: 20, aspect_ratio: '1:1', subtitles: false, subtitles_style: 'tiktok', location: 'a kitchen' },
      identity,
    );
    expect(input.duration).toBe(20);
    expect(input.aspect_ratio).toBe('1:1');
    expect(input.subtitles).toBe(false);
    expect(input.subtitles_style).toBe('tiktok');
    expect(input.location).toBe('a kitchen');
  });

  it('always carries the SAME skill_run_id given to it — the whole point of resume', () => {
    const input = buildMakeUgcVideoWorkflowInput('user-1', 'the-original-run-id', {}, identity);
    expect(input.skill_run_id).toBe('the-original-run-id');
  });
});

describe('buildBrollTalkingHeadWorkflowInput', () => {
  it('maps body + resolved portraitUrl into the workflow input shape, with defaults applied', () => {
    const input = buildBrollTalkingHeadWorkflowInput(
      'user-1',
      'skill-run-1',
      { actor_image_url: 'https://r2.example.com/sheet.png', broll_video_url: 'https://r2.example.com/broll.mp4', script: 'Line one.' },
      'https://r2.example.com/portrait.png',
    );
    expect(input).toEqual({
      skill_run_id: 'skill-run-1',
      user_id: 'user-1',
      actor_image_url: 'https://r2.example.com/sheet.png',
      portrait_url: 'https://r2.example.com/portrait.png',
      broll_video_url: 'https://r2.example.com/broll.mp4',
      script: 'Line one.',
      audio_url: undefined,
      duration: 20,
      aspect_ratio: '9:16',
      subtitles: false,
      overlay_size: 'large',
      overlay_position: 'bottom',
      broll_width_rate: undefined,
      broll_start_time: undefined,
      broll_fade_out: undefined,
      voice_ref_audio_url: undefined,
      watermark_text: undefined,
      language: undefined,
      background_music: undefined,
    });
  });

  it('tolerates an unresolved (undefined) portraitUrl — best-effort lookup', () => {
    const input = buildBrollTalkingHeadWorkflowInput('user-1', 'skill-run-2', { actor_image_url: 'https://r2.example.com/sheet.png' }, undefined);
    expect(input.portrait_url).toBeUndefined();
  });

  it('always carries the SAME skill_run_id given to it — the whole point of resume', () => {
    const input = buildBrollTalkingHeadWorkflowInput('user-1', 'the-original-run-id', {}, undefined);
    expect(input.skill_run_id).toBe('the-original-run-id');
  });
});

describe('buildMakeStorybookWorkflowInput', () => {
  const resolvedChars = [
    { name: 'Mira', ref_url: 'https://r2.example.com/mira.png', description: 'a curious fox' },
    { name: 'Theo', description: 'a sleepy owl' },
  ];
  const scenes = [
    { speaker: 'Mira', line: 'Let\'s go exploring!', visual_description: 'forest clearing at dawn' },
    { speaker: 'Theo', line: 'Do we have to?', visual_description: 'owl yawning on a branch' },
  ];

  it('maps resolved characters + scenes into the workflow input shape, with defaults applied', () => {
    const input = buildMakeStorybookWorkflowInput(
      'user-1',
      'skill-run-1',
      { title: 'The Big Adventure' },
      { resolvedChars, scenes },
    );
    expect(input).toEqual({
      skill_run_id: 'skill-run-1',
      user_id: 'user-1',
      title: 'The Big Adventure',
      characters: [
        { name: 'Mira', ref_url: 'https://r2.example.com/mira.png', description: 'a curious fox' },
        { name: 'Theo', ref_url: undefined, description: 'a sleepy owl' },
      ],
      art_style: 'flat_vector_cartoon',
      style_notes: undefined,
      scenes: [
        { speaker: 'Mira', line: 'Let\'s go exploring!', visual_description: 'forest clearing at dawn' },
        { speaker: 'Theo', line: 'Do we have to?', visual_description: 'owl yawning on a branch' },
      ],
      aspect_ratio: '9:16',
      subtitles: false,
      subtitles_style: 'hormozi',
    });
  });

  it('passes explicit art_style/aspect_ratio/subtitles through instead of the defaults', () => {
    const input = buildMakeStorybookWorkflowInput(
      'user-1',
      'skill-run-2',
      { art_style: 'watercolor', aspect_ratio: '1:1', subtitles: true, subtitles_style: 'tiktok' },
      { resolvedChars, scenes },
    );
    expect(input.art_style).toBe('watercolor');
    expect(input.aspect_ratio).toBe('1:1');
    expect(input.subtitles).toBe(true);
    expect(input.subtitles_style).toBe('tiktok');
  });

  it('always carries the SAME skill_run_id given to it — the whole point of resume', () => {
    const input = buildMakeStorybookWorkflowInput('user-1', 'the-original-run-id', {}, { resolvedChars, scenes });
    expect(input.skill_run_id).toBe('the-original-run-id');
  });
});
