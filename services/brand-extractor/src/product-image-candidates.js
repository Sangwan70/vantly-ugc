// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Pure filtering/ranking logic for candidate product images (Video
 * Generation Flow audit improvement #10: "paste a URL, get a drafted
 * ad"). Deliberately split out from brand-extract.js's page.evaluate()
 * DOM walk (see collectImageCandidates there) so this decision logic is
 * plain Node code with zero Playwright/DOM dependency -- testable with
 * node:test and no browser, no network, no new dependency for a package
 * that otherwise has no test harness at all.
 *
 * Heuristic, not ML: a PDP usually has several real product photos, and
 * og:image is often a lifestyle/banner shot rather than a clean isolated
 * product shot, so this surfaces CANDIDATES for a human to pick from
 * rather than guessing "the" product image -- picking wrong here means
 * generating a video around the wrong product photo with no obvious way
 * for the user to notice before it renders.
 */

const MIN_SIZE = 200; // px, both width and height, as rendered
const MAX_ASPECT = 3; // drop extreme aspect ratios -- banners/dividers, not product shots
const MAX_CANDIDATES = 8;
const NON_PRODUCT_ALT = /logo|icon|avatar|sprite|placeholder/i;

/**
 * @param {Array<{src?: string, width?: number, height?: number, alt?: string, inChrome?: boolean}>} rawItems
 *   Raw <img> descriptors from the page (see collectImageCandidates in
 *   brand-extract.js) -- width/height are RENDERED size (getBoundingClientRect),
 *   falling back to natural size, not always present/positive for a
 *   lazy-loaded image whose real src never populated.
 * @returns {string[]} up to MAX_CANDIDATES image src strings, largest rendered area first.
 */
export function selectProductImageCandidates(rawItems) {
  const seen = new Set();
  const candidates = [];
  for (const item of rawItems ?? []) {
    if (!item || item.inChrome) continue; // header/nav/footer -- logos, nav icons, social icons
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    if (width < MIN_SIZE || height < MIN_SIZE) continue;
    const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (aspect > MAX_ASPECT) continue;
    const src = typeof item.src === 'string' ? item.src.trim() : '';
    if (!src || seen.has(src)) continue;
    if (NON_PRODUCT_ALT.test(item.alt ?? '')) continue;
    seen.add(src);
    candidates.push({ src, area: width * height });
  }
  candidates.sort((a, b) => b.area - a.area);
  return candidates.slice(0, MAX_CANDIDATES).map((c) => c.src);
}
