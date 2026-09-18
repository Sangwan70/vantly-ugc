// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Uses node:test (built in to Node 20+, per this package's own engines
// field) rather than adding a test framework dependency to a
// single-purpose microservice that otherwise has none. Run with:
//   node --test src/__tests__/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectProductImageCandidates } from '../product-image-candidates.js';

function img(overrides) {
  return { src: 'https://example.com/a.jpg', width: 400, height: 400, alt: '', inChrome: false, ...overrides };
}

describe('selectProductImageCandidates', () => {
  test('keeps an image at/above the minimum rendered size', () => {
    const result = selectProductImageCandidates([img({ src: 'x.jpg', width: 300, height: 300 })]);
    assert.deepEqual(result, ['x.jpg']);
  });

  test('drops an image below the minimum rendered size (icon/thumbnail)', () => {
    const result = selectProductImageCandidates([img({ src: 'icon.png', width: 40, height: 40 })]);
    assert.deepEqual(result, []);
  });

  test('drops images inside header/nav/footer', () => {
    const result = selectProductImageCandidates([img({ src: 'header-logo.png', inChrome: true })]);
    assert.deepEqual(result, []);
  });

  test('drops extreme aspect ratios (banners/dividers)', () => {
    const result = selectProductImageCandidates([img({ src: 'banner.jpg', width: 1600, height: 100 })]);
    assert.deepEqual(result, []);
  });

  test('drops images whose alt text flags them as non-product', () => {
    for (const alt of ['Company Logo', 'user avatar', 'loading placeholder', 'nav icon']) {
      const result = selectProductImageCandidates([img({ src: 'x.jpg', alt })]);
      assert.deepEqual(result, [], `expected alt="${alt}" to be dropped`);
    }
  });

  test('dedupes by src', () => {
    const result = selectProductImageCandidates([
      img({ src: 'same.jpg', width: 500, height: 500 }),
      img({ src: 'same.jpg', width: 500, height: 500 }),
    ]);
    assert.deepEqual(result, ['same.jpg']);
  });

  test('sorts by rendered area descending', () => {
    const result = selectProductImageCandidates([
      img({ src: 'small.jpg', width: 210, height: 210 }),
      img({ src: 'big.jpg', width: 800, height: 800 }),
      img({ src: 'medium.jpg', width: 400, height: 400 }),
    ]);
    assert.deepEqual(result, ['big.jpg', 'medium.jpg', 'small.jpg']);
  });

  test('caps at 8 candidates', () => {
    const items = Array.from({ length: 20 }, (_, i) => img({ src: `img${i}.jpg`, width: 300 + i, height: 300 + i }));
    const result = selectProductImageCandidates(items);
    assert.equal(result.length, 8);
    // Largest area (highest i) should win the cap, not first-seen order.
    assert.deepEqual(result, ['img19.jpg', 'img18.jpg', 'img17.jpg', 'img16.jpg', 'img15.jpg', 'img14.jpg', 'img13.jpg', 'img12.jpg']);
  });

  test('handles missing/empty input gracefully', () => {
    assert.deepEqual(selectProductImageCandidates([]), []);
    assert.deepEqual(selectProductImageCandidates(undefined), []);
    assert.deepEqual(selectProductImageCandidates(null), []);
  });

  test('drops an item with no src (lazy-load placeholder that never populated)', () => {
    const result = selectProductImageCandidates([img({ src: '' }), img({ src: undefined })]);
    assert.deepEqual(result, []);
  });
});
