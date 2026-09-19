// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Lightweight SSRF-safe fetcher for the optional "reference URL" field on
 * make_podcast/make_storybook's AI-draft endpoints (POST
 * /v1/assist/draft-podcast, /v1/assist/draft-storybook) — the user pastes a
 * blog post / article / product page and the draft writer reads its text as
 * grounding context.
 *
 * Deliberately NOT the heavier services/brand-extractor (Playwright +
 * Chromium, its own deployed service) — that one is built for landing-page
 * brand-kit extraction (hero image, palette, logo, product photos) and
 * needs BRAND_EXTRACTOR_URL/BRAND_EXTRACTOR_SECRET wired up separately.
 * Here we only need the page's visible TEXT to feed an LLM as context, so a
 * plain HTTPS GET + tag-strip is enough and avoids a second service
 * dependency for something this small.
 *
 * Reuses r2-upload.ts's SSRF-hardening approach (see its own header
 * comment for the full rationale): DNS-resolve the host ourselves and
 * reject any private/loopback/link-local/CGNAT address, PIN the connection
 * to the validated IP (SNI + Host still set to the real hostname so TLS
 * validates), follow redirects MANUALLY with re-validation at every hop,
 * and stream under a hard byte cap. isPrivateIp/validateOutboundUrl are
 * imported from r2-upload.ts (single source of truth for "is this address
 * safe to fetch") rather than redefined here.
 */

import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookupCb } from 'node:dns';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import { isPrivateIp, validateOutboundUrl } from './r2-upload.js';

const dnsLookupAll = promisify(dnsLookupCb);

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB of HTML is already generous for an article page
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

/** Plain text handed to the LLM as context — capped well under any model's
 *  practical context budget and under DraftPodcast/StorybookRequestSchema's
 *  own reasoning about prompt size. */
export const MAX_REFERENCE_TEXT_CHARS = 8_000;

export class UrlFetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlFetchFailedError';
  }
}

async function resolveToPublicIp(hostname: string): Promise<{ address: string; family: number }> {
  const addrs = (await dnsLookupAll(hostname, { all: true, verbatim: true })) as Array<{
    address: string;
    family: number;
  }>;
  if (!addrs.length) throw new UrlFetchFailedError('host did not resolve');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new UrlFetchFailedError('URL resolves to a private/internal address');
  }
  return addrs[0];
}

interface FetchedBody {
  status: number;
  location?: string;
  contentType: string;
  buffer: Buffer;
}

function httpsGetPinned(url: URL, ip: string, family: number): Promise<FetchedBody> {
  return new Promise<FetchedBody>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: ip,
        family,
        servername: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Host: url.hostname, 'User-Agent': 'vantly-ugc/1', Accept: 'text/html,text/plain,*/*' },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, location: String(res.headers.location), contentType, buffer: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers['content-length'] ?? '0');
        if (declared > MAX_RESPONSE_BYTES) {
          req.destroy();
          reject(new UrlFetchFailedError(`response too large (${declared} bytes)`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new UrlFetchFailedError('response exceeds size cap'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, contentType, buffer: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new UrlFetchFailedError('fetch timeout')));
    req.on('error', (err) => reject(err instanceof UrlFetchFailedError ? err : new UrlFetchFailedError(err.message)));
    req.end();
  });
}

/** Strip scripts/styles/tags down to plain text, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Fetch a public https URL and return its page text, truncated to
 * MAX_REFERENCE_TEXT_CHARS. Throws UrlFetchFailedError on anything that
 * makes the URL unsafe or unreadable (private address, too large, non-2xx,
 * non-text content type, timeout) — callers treat this as "skip the
 * reference text, draft from the rest" rather than a hard failure.
 */
export async function fetchUrlText(rawUrl: string): Promise<string> {
  let url = validateOutboundUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { address, family } = await resolveToPublicIp(url.hostname);
    const res = await httpsGetPinned(url, address, family);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = validateOutboundUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new UrlFetchFailedError(`fetch failed (${res.status})`);
    }
    if (!/text\/html|text\/plain|application\/xhtml/i.test(res.contentType) && res.contentType !== '') {
      throw new UrlFetchFailedError(`URL is not a text page (content-type: ${res.contentType || 'unknown'})`);
    }
    const text = htmlToText(res.buffer.toString('utf-8'));
    if (!text) throw new UrlFetchFailedError('page had no readable text');
    return text.slice(0, MAX_REFERENCE_TEXT_CHARS);
  }
  throw new UrlFetchFailedError('too many redirects');
}
