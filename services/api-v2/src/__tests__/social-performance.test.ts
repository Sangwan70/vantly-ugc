// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Pre-publish checklist's counterpart for already-published videos
// (Milestone 2, item 3 / Video Generation Flow audit improvement #7:
// "close the loop with published performance data ... this hook/actor
// combo performed better"). Pure-module level, same convention as
// make-ugc-checklist.test.ts -- rollupPerformance and classifyHookOpener
// take plain data in, no server/DB import.

import { describe, it, expect } from 'vitest';
import { classifyHookOpener } from '../skills/make-ugc-router.js';
import { rollupPerformance, averageOf, type PerformancePublication } from '../skills/social-performance.js';

function pub(overrides: Partial<PerformancePublication>): PerformancePublication {
  return {
    id: 'pub_1',
    integration_id: 'int_1',
    run_id: null,
    source: null,
    release_url: null,
    published_at: null,
    hook: 'no_script',
    actor: null,
    caption_style: null,
    metrics: { views: null, completion_rate: null, ctr: null, updated_at: null },
    ...overrides,
  };
}

describe('classifyHookOpener', () => {
  it('returns no_script for an absent/empty script', () => {
    expect(classifyHookOpener(undefined)).toBe('no_script');
    expect(classifyHookOpener(null)).toBe('no_script');
    expect(classifyHookOpener('   ')).toBe('no_script');
  });

  it('returns weak_opener for a known throat-clearing lead-in', () => {
    expect(classifyHookOpener('So today I wanted to show you this.')).toBe('weak_opener');
    expect(classifyHookOpener('Hey guys, welcome back to the channel.')).toBe('weak_opener');
  });

  it('returns direct_opener for a script that opens with a claim/question', () => {
    expect(classifyHookOpener('This $12 gadget replaced three things in my kitchen.')).toBe('direct_opener');
  });
});

describe('averageOf', () => {
  it('returns null for an empty array', () => {
    expect(averageOf([])).toBeNull();
  });

  it('averages a non-empty array', () => {
    expect(averageOf([10, 20, 30])).toBe(20);
  });
});

describe('rollupPerformance', () => {
  it('groups by key and averages each metric independently, ignoring nulls', () => {
    const publications = [
      pub({ id: 'p1', actor: 'char_a', metrics: { views: 100, completion_rate: 0.5, ctr: null, updated_at: 't' } }),
      pub({ id: 'p2', actor: 'char_a', metrics: { views: 300, completion_rate: null, ctr: 0.1, updated_at: 't' } }),
      pub({ id: 'p3', actor: 'char_b', metrics: { views: 50, completion_rate: 0.2, ctr: 0.05, updated_at: 't' } }),
    ];
    const byActor = rollupPerformance(publications, (p) => p.actor);
    const charA = byActor.find((r) => r.key === 'char_a')!;
    const charB = byActor.find((r) => r.key === 'char_b')!;

    expect(charA.count).toBe(2);
    expect(charA.avg_views).toBe(200); // (100+300)/2
    expect(charA.avg_completion_rate).toBe(0.5); // only p1 has one -- not dragged down by p2's null
    expect(charA.avg_ctr).toBe(0.1); // only p2 has one

    expect(charB.count).toBe(1);
    expect(charB.avg_views).toBe(50);
  });

  it('excludes publications whose key resolves to null', () => {
    const publications = [
      pub({ id: 'p1', actor: 'char_a', metrics: { views: 100, completion_rate: null, ctr: null, updated_at: 't' } }),
      pub({ id: 'p2', actor: null, metrics: { views: 999, completion_rate: null, ctr: null, updated_at: 't' } }),
    ];
    const byActor = rollupPerformance(publications, (p) => p.actor);
    expect(byActor).toHaveLength(1);
    expect(byActor[0].key).toBe('char_a');
  });

  it('sorts groups by avg_views descending, with no-views groups last', () => {
    const publications = [
      pub({ id: 'p1', hook: 'weak_opener', metrics: { views: 50, completion_rate: null, ctr: null, updated_at: 't' } }),
      pub({ id: 'p2', hook: 'direct_opener', metrics: { views: 500, completion_rate: null, ctr: null, updated_at: 't' } }),
      pub({ id: 'p3', hook: 'no_script', metrics: { views: null, completion_rate: null, ctr: null, updated_at: 't' } }),
    ];
    const byHook = rollupPerformance(publications, (p) => p.hook);
    expect(byHook.map((r) => r.key)).toEqual(['direct_opener', 'weak_opener', 'no_script']);
  });

  it('returns an empty array for no publications', () => {
    expect(rollupPerformance([], (p) => p.actor)).toEqual([]);
  });
});
