// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// make_ugc bulk generation ("variants" — Milestone 2, item 1 of the Video
// Generation Flow audit: "accept an array of variant overrides... and return
// one quote covering all of them up front"). Pins validateMakeUgcVariants at
// the pure-module level (no server/DB import — mirrors quote-run-parity.test.ts's
// own approach), since this is the function every invalid-batch and every
// price-coherence guarantee depends on.

import { describe, it, expect } from 'vitest';
import { validateMakeUgcVariants, buildBatchRunRecord } from '../skills/make-ugc-router.js';
import { quoteSkillCredits } from '../skills/credit-quotes.js';
import { MAKE_UGC_MAX_VARIANTS } from '../skills/registry.js';

describe('validateMakeUgcVariants', () => {
  const base = { script: 'Check out this product — you have to try it.' };

  it('accepts variants that only override a subset of the base fields', () => {
    const result = validateMakeUgcVariants(base, [
      { character: 'char_abc' },
      { character: 'char_def' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(2);
    // The base script survives into both variants (the override only sets `character`).
    expect(result.variants[0].props.script).toBe(base.script);
    expect(result.variants[1].props.script).toBe(base.script);
    expect(result.variants[0].props.character).toBe('char_abc');
    expect(result.variants[1].props.character).toBe('char_def');
  });

  it('an override can replace a base field entirely (e.g. a different hook per variant)', () => {
    const result = validateMakeUgcVariants(base, [{ script: 'A totally different hook line here.' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants[0].props.script).toBe('A totally different hook line here.');
  });

  it('rejects the WHOLE batch when any one variant is invalid, with the failing index', () => {
    const result = validateMakeUgcVariants(base, [
      { character: 'char_abc' }, // valid
      { person: 'x' }, // invalid: person must be >= 8 chars
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].variant_index).toBe(1);
  });

  it('rejects a variant that conflicts with itself even though the base alone is valid', () => {
    // Base has no identity fields; this override sets two of the mutually
    // exclusive ones at once — invalid only once merged, not on its own base.
    const result = validateMakeUgcVariants(base, [{ person: 'a friendly narrator', image: 'https://x/y.png' }]);
    expect(result.ok).toBe(false);
  });

  it('never validates more than MAKE_UGC_MAX_VARIANTS entries, even if the caller sends more', () => {
    const overrides = Array.from({ length: MAKE_UGC_MAX_VARIANTS + 5 }, (_, i) => ({ character: `char_${i}` }));
    const result = validateMakeUgcVariants(base, overrides);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(MAKE_UGC_MAX_VARIANTS);
  });

  it('an empty overrides array validates to an empty (but ok) variant list', () => {
    const result = validateMakeUgcVariants(base, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(0);
  });
});

describe('make_ugc batch credit coherence (extends invariant 9 to N variants)', () => {
  it('summing quoteSkillCredits over each routed variant matches what a caller would be charged per-variant individually', () => {
    const base = { script: 'Short punchy line about the product.' };
    const overrides = [{ character: 'char_abc' }, { caption_style: 'tiktok' as const }, {}];
    const result = validateMakeUgcVariants(base, overrides);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const total = result.variants.reduce((sum, v) => sum + quoteSkillCredits(v.routed.slug, v.routed.body), 0);
    // Recompute independently via quoteSkillCredits('make_ugc', ...) per variant
    // (the same function a single, non-batch /quote call would use) to prove
    // the batch's per-variant pricing can never drift from single-run pricing.
    const independentTotal = overrides.reduce((sum, override) => {
      const merged = { ...base, ...override };
      return sum + quoteSkillCredits('make_ugc', merged);
    }, 0);
    expect(total).toBe(independentTotal);
  });
});

describe('buildBatchRunRecord', () => {
  it('keeps the HTTP status distinct from a successful run body\'s own `status` field', () => {
    // A real dispatchMakeUgcVideo/primitive success body includes
    // status: 'submitted' -- naively spreading it after an HTTP-status key
    // named `status` would silently clobber the numeric code with that
    // string. Regression test for exactly that bug, caught while building
    // dispatchMakeUgcBatch's succeeded/failed tally.
    const record = buildBatchRunRecord(2, {
      status: 202,
      body: { skill_run_id: 'run_abc', skill: 'make_ugc_video', status: 'submitted' },
    });
    expect(record.variant_index).toBe(2);
    expect(record.http_status).toBe(202);
    expect(record.status).toBe('submitted'); // the run's own status survives, untouched
  });

  it('a failed dispatch\'s error body has no status field to collide with', () => {
    const record = buildBatchRunRecord(0, {
      status: 402,
      body: { error: 'insufficient_credits', needed: 280, available: 100 },
    });
    expect(record.http_status).toBe(402);
    expect(record.error).toBe('insufficient_credits');
  });

  it('a batch of one success and one failure tallies correctly using http_status', () => {
    const runs = [
      buildBatchRunRecord(0, { status: 202, body: { status: 'submitted', skill_run_id: 'a' } }),
      buildBatchRunRecord(1, { status: 402, body: { error: 'insufficient_credits' } }),
    ];
    const succeeded = runs.filter((r) => (r.http_status as number) < 400).length;
    expect(succeeded).toBe(1);
  });
});
