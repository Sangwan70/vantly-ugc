// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Server-to-server client for the standalone brand-extractor service
 * (services/brand-extractor -- Playwright + Chromium, deployed separately
 * so its heavy Chromium image doesn't bloat api-v2). Mirrors
 * apps/web/app/api/onboarding/brand-extract/route.ts's own proxy call
 * (same env vars, same X-Worker-Secret auth) -- that route calls it for
 * onboarding's "brand kit" step; this one is api-v2's own path in, added
 * for POST /v1/assist/draft-script-from-url (Video Generation Flow audit
 * improvement #10: "paste a URL, get a drafted ad").
 *
 * Env:
 *   BRAND_EXTRACTOR_URL    - e.g. https://brand-extractor-production.up.railway.app
 *   BRAND_EXTRACTOR_SECRET - same value as the service's own WORKER_SECRET
 */

const SERVICE_URL = process.env.BRAND_EXTRACTOR_URL;
const SERVICE_SECRET = process.env.BRAND_EXTRACTOR_SECRET;

export interface ExtractedBrand {
  url: string;
  title: string | null;
  description: string | null;
  hero: string | null;
  brand_name: string | null;
  screenshot: string | null;
  screenshot_mobile: string | null;
  image: string | null;
  /** Candidate product photos (see product-image-candidates.js) -- NOT
   *  auto-picked, since a wrong guess here means generating a video
   *  around the wrong product with no obvious way for the caller to
   *  notice before it renders. Caller shows these for a human to pick. */
  product_image_candidates: string[];
  logo: string | null;
  logo_source: 'ai-crop' | 'meta' | null;
  theme_color: string | null;
  palette: string[];
  palette_source: 'ai' | 'k-bucket';
  extracted_at: string;
}

export class BrandExtractorNotConfiguredError extends Error {
  constructor() {
    super('brand-extractor not configured (BRAND_EXTRACTOR_URL / BRAND_EXTRACTOR_SECRET)');
  }
}

export class BrandExtractionFailedError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** ~5-15s typical per the service's own doc comment; 30s upper bound matches
 *  the proxy timeout apps/web's own onboarding route already uses. */
const EXTRACT_TIMEOUT_MS = 30_000;

export async function extractBrandFromUrl(url: string, jobId: string): Promise<ExtractedBrand> {
  if (!SERVICE_URL || !SERVICE_SECRET) {
    throw new BrandExtractorNotConfiguredError();
  }
  let resp: globalThis.Response;
  try {
    resp = await fetch(`${SERVICE_URL.replace(/\/+$/, '')}/brand-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': SERVICE_SECRET },
      body: JSON.stringify({ url, job_id: jobId }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BrandExtractionFailedError(err instanceof Error ? err.message : 'brand-extractor fetch failed', 502);
  }
  let json: { ok?: boolean; brand?: ExtractedBrand; error?: string };
  try {
    json = (await resp.json()) as typeof json;
  } catch {
    throw new BrandExtractionFailedError('brand-extractor returned an unparseable response', 502);
  }
  if (!resp.ok || !json?.ok || !json.brand) {
    throw new BrandExtractionFailedError(json?.error || `brand-extractor ${resp.status}`, resp.status >= 400 && resp.status < 500 ? 400 : 502);
  }
  return json.brand;
}
