// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Pre-publish checklist (Milestone 2, item 2 of the Video Generation Flow
// audit's 10 Improvements, §6: "a lightweight pre-publish scoring or
// checklist step ... caption readability, hook-in-first-3-seconds
// heuristic, duration-vs-platform fit"). Pure-module level, same approach
// as make-ugc-variants.test.ts -- scorePrePublishChecklist takes only
// `props` + decideMakeUgcRoute's own output, no server/DB import.

import { describe, it, expect } from 'vitest';
import { decideMakeUgcRoute, scorePrePublishChecklist, type MakeUgcProps } from '../skills/make-ugc-router.js';

function score(props: MakeUgcProps) {
  const routed = decideMakeUgcRoute(props);
  return { routed, checklist: scorePrePublishChecklist(props, routed) };
}

function item(checklist: ReturnType<typeof scorePrePublishChecklist>, id: string) {
  const found = checklist.items.find((i) => i.id === id);
  if (!found) throw new Error(`no checklist item with id ${id}`);
  return found;
}

describe('scorePrePublishChecklist', () => {
  it('flags a throat-clearing opener', () => {
    const { checklist } = score({ script: 'So today I wanted to show you this new product.' });
    expect(item(checklist, 'hook_in_first_3s').passed).toBe(false);
  });

  it('passes a script that opens with a direct claim/question, not a known weak opener', () => {
    const { checklist } = score({ script: 'This $12 gadget replaced three things in my kitchen.' });
    expect(item(checklist, 'hook_in_first_3s').passed).toBe(true);
  });

  it('marks hook + caption readability not-applicable for a silent scene_action clip', () => {
    const { checklist } = score({ scene_action: 'dancing in a sunlit kitchen', character: 'char_abc' });
    expect(item(checklist, 'hook_in_first_3s').passed).toBe(true);
    expect(item(checklist, 'hook_in_first_3s').message).toMatch(/not applicable/);
    expect(item(checklist, 'caption_readability').passed).toBe(true);
    expect(item(checklist, 'caption_readability').message).toMatch(/not applicable/);
  });

  it('caption_readability passes when captions are off, regardless of pace', () => {
    // A dense, fast script -- would fail readability if captions were on.
    const denseScript = Array.from({ length: 40 }, () => 'word').join(' ');
    const { checklist } = score({ script: denseScript, captions: false });
    expect(item(checklist, 'caption_readability').passed).toBe(true);
    expect(item(checklist, 'caption_readability').message).toMatch(/off/);
  });

  it('caption_readability passes by construction on every current make_ugc route', () => {
    // Every route decideMakeUgcRoute picks sets `body.duration` FROM
    // fitDuration(script) (or, for make_broll_talking_head, sets no
    // duration at all -- scorePrePublishChecklist then estimates one at
    // the same comfortable pace). Either way, duration is always DERIVED
    // from word count, never independently user-chosen alongside a script,
    // so this check passes by construction today -- pinning that here so
    // a future change that decouples them (e.g. a route that lets a user
    // pick both a script AND an independent duration) is caught by this
    // test starting to fail, not silently.
    const script = Array.from({ length: 30 }, () => 'word').join(' ');
    const { checklist } = score({ script, character: 'char_abc', captions: true });
    expect(item(checklist, 'caption_readability').passed).toBe(true);
  });

  it('caption_readability fails when the resolved duration is too short for the script (scorer-level check)', () => {
    // Exercises the scorer directly against a synthetic `routed.body` --
    // this is the shape a route WOULD produce if it ever let a script and
    // an independently-chosen (too-short) duration through together, which
    // no current make_ugc route does (see the passing test above), but the
    // scorer needs to actually catch it when one does.
    const script = Array.from({ length: 30 }, () => 'word').join(' '); // 30 words
    const checklist = scorePrePublishChecklist(
      { script, captions: true },
      { slug: 'make_simple_selfie', body: { duration: 5, subtitles: true } }, // 30 words / 5s = 6 wps
    );
    expect(item(checklist, 'caption_readability').passed).toBe(false);
    expect(item(checklist, 'caption_readability').message).toMatch(/words\/sec/);
  });

  it('duration_platform_fit fails for 1:1 (recommends 9:16 for TikTok/Reels/Shorts)', () => {
    const { checklist } = score({ script: 'A good hook line here.', aspect_ratio: '1:1' });
    expect(item(checklist, 'duration_platform_fit').passed).toBe(false);
    expect(item(checklist, 'duration_platform_fit').message).toMatch(/9:16/);
  });

  it('duration_platform_fit passes for the default 9:16', () => {
    const { checklist } = score({ script: 'A good hook line here.' });
    expect(item(checklist, 'duration_platform_fit').passed).toBe(true);
  });

  it('passed/total tally matches the items actually returned', () => {
    const { checklist } = score({ script: 'So today I wanted to show this off.', aspect_ratio: '1:1' });
    expect(checklist.total).toBe(3);
    expect(checklist.passed).toBe(checklist.items.filter((i) => i.passed).length);
  });
});
