// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/assist/draft-script
 *
 * Turns a one-line pitch ("a coffee shop opening ad") into a ready-to-use
 * spoken script for make_ugc's `script` field — for the My Prompts wizard,
 * built for non-technical users who don't know what a good UGC script
 * sounds like. Returns text only; the caller (the wizard UI) always shows
 * it in an editable textarea afterward so the user can put their own
 * personal touch on it before submitting — this endpoint drafts, it never
 * decides the final wording.
 *
 * Reuses the same Anthropic call path as the agent chat (callAnthropicMessages),
 * no new provider wiring.
 *
 * POST /v1/assist/draft-script-from-url (Video Generation Flow audit
 * improvement #10: "paste a URL, get a drafted ad" — Creatify/Pippit's
 * biggest UX win, per the audit) is the same drafter fed a pitch it
 * synthesizes itself from a URL, via the brand-extractor service (see
 * lib/brand-extractor-client.ts) instead of one the user typed. Kept
 * deliberately human-in-the-loop, per the audit's own warning that this
 * item "most changes the product's shape (from 'you already know what
 * you want' to 'we help you decide what to make')": it drafts a script
 * AND returns candidate product images for the caller to show and let
 * the user pick from — it never auto-submits a make_ugc run, and the
 * returned script still lands in the same editable textarea every other
 * draft does.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { callAnthropicMessages } from '../../lib/anthropic-client.js';
import { captureAiRouteFailure } from '../../lib/ai-route-alert.js';
import {
  extractBrandFromUrl,
  BrandExtractorNotConfiguredError,
  BrandExtractionFailedError,
  type ExtractedBrand,
} from '../../lib/brand-extractor-client.js';

export const MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6';

// 45s: generous enough for a reasoning-heavy model to think through word
// count/phrasing before emitting the <script> tag (see max_tokens above)
// without making a stuck request hang the wizard indefinitely.
export const DRAFT_TIMEOUT_MS = 45_000;

// Fallback model tried ONCE if the primary model times out, errors, or
// returns something unparseable -- 'claude-haiku-4-5' is already this
// codebase's established fast-model choice for latency-sensitive Anthropic
// calls (see primitive-worker-vnext/src/client/anthropic.ts's portrait
// prompt builder). A live HAR showed the primary model missing even the
// generous 45s window on an ordinary pitch; retrying on a faster model
// actually resolves the user's request instead of just failing faster or
// with a clearer message. Distinct from generateImageWithFallback's
// PRIMARY/proxy fallback (openai.ts) -- that one switches network path on
// a connection failure; this one switches MODEL on a latency/quality
// failure, so it also covers the model returning something unparseable,
// not just a timeout.
export const FALLBACK_MODEL = process.env.ANTHROPIC_AGENT_FALLBACK_MODEL || 'claude-haiku-4-5';
// Shorter than the primary's: haiku is materially faster, and the two
// timeouts stack (worst case ~65s total) only on the rare request that
// exhausts both -- most fall back well before this.
export const FALLBACK_TIMEOUT_MS = 20_000;

/** AbortSignal.timeout() rejects/aborts with a DOMException named 'TimeoutError' — detect that
 * specifically so a slow model call is reported as a timeout, not mislabeled as a parse failure
 * (a real bug that shipped: the AbortSignal could also fire mid-body-read, after `upstream.ok`
 * was already true, and got swallowed by the JSON.parse catch below as "unparseable response"). */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

/**
 * One model-call attempt's failure, already carrying the exact HTTP
 * status + JSON body draftScriptRoute would have sent for it directly --
 * lets the route try a second (fallback) model on ANY of these without
 * duplicating the status/body logic for each failure kind.
 */
export class DraftAttemptError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: { error: { code: string; message: string; detail?: string } },
  ) {
    super(body.error.message);
    this.name = 'DraftAttemptError';
  }
}

/** Call `model`, bounded by `timeoutMs`, and return its raw text content blocks
 *  joined together (NOT yet <script>-tag-extracted -- draftScriptRoute does that
 *  once, after whichever attempt succeeds). Throws DraftAttemptError on any
 *  failure so the caller can retry with a different model without re-deriving
 *  the response shape. */
export async function attemptDraft(model: string, timeoutMs: number, userMessage: string, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  let upstream: globalThis.Response;
  try {
    upstream = await callAnthropicMessages(
      {
        model,
        // Generous headroom: some upstream models (esp. via
        // MODEL_PROVIDER=openrouter) reason inline before the <script> tag
        // rather than in a separate thinking channel, and 400 was tight
        // enough that a request could get cut off mid-reasoning, before
        // ever emitting the tag -- see the <script> extraction in
        // draftScriptRoute, which is what actually keeps stray reasoning
        // out of the result.
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new DraftAttemptError(504, {
        error: { code: 'UPSTREAM_TIMEOUT', message: `The AI script writer took too long to respond (over ${timeoutMs / 1000}s) — try again.` },
      });
    }
    throw new DraftAttemptError(502, { error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    throw new DraftAttemptError(502, {
      error: { code: 'UPSTREAM_ERROR', message: `Model call failed (${upstream.status})`, detail: text.slice(0, 500) },
    });
  }

  let data: { content?: Array<{ type?: string; text?: string }> };
  try {
    data = (await upstream.json()) as typeof data;
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new DraftAttemptError(504, {
        error: { code: 'UPSTREAM_TIMEOUT', message: `The AI script writer took too long to respond (over ${timeoutMs / 1000}s) — try again.` },
      });
    }
    throw new DraftAttemptError(502, { error: { code: 'UPSTREAM_ERROR', message: 'Model returned an unparseable response' } });
  }

  return (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

const DraftScriptRequestSchema = z.object({
  pitch: z.string().min(6).max(400).describe('One-line description of the ad, e.g. "a coffee shop\'s grand opening, 20% off this week".'),
  target_duration: z.enum(['5', '10', '15', 'auto']).default('auto'),
  look: z.enum(['natural', 'commercial', 'raw_iphone']).optional(),
  tone_notes: z.string().max(200).optional().describe('Optional extra guidance, e.g. brand voice, a phrase to include, an audience.'),
});

const WORD_BRACKET: Record<'5' | '10' | '15' | 'auto', string> = {
  '5': '1-11 words — a single punchy line, nothing more.',
  '10': '12-22 words — one clear beat: a hook plus its payoff.',
  '15': '23-35 words — a hook, one supporting detail, and a short close.',
  auto: '12-22 words, unless the pitch clearly calls for something punchier or more detailed — then adjust, but stay within 1-35 words.',
};

const LOOK_GUIDANCE: Record<'natural' | 'commercial' | 'raw_iphone', string> = {
  natural: 'Warm and casual, like talking to a friend.',
  commercial: 'Polished and confident, but still conversational — never stiff or corporate.',
  raw_iphone: 'Unscripted-sounding, a little messy, very real — the opposite of a produced ad.',
};

const SYSTEM_PROMPT = `You are an expert direct-response copywriter who writes short spoken scripts for AI-generated vertical UGC (user-generated-content-style) video ads. You turn a one-line pitch into a single, ready-to-perform spoken script — nothing else.

Rules, in order of importance:
1. Write ONLY the words the on-camera person will say aloud. No stage directions, no scene descriptions, no camera notes, no hashtags, no emojis, no surrounding quotation marks, no labels like "Script:" or "Here's your script:".
2. First person, conversational — like a real person talking straight to camera to a friend, not an ad voiceover and not a press release. Contractions are good. Avoid marketing jargon ("elevate", "seamless", "game-changer", "unlock", "revolutionize") unless the pitch itself uses that language on purpose.
3. Open with a hook in the first 4-6 words — a question, a bold claim, or mid-thought energy ("Okay so—", "Wait, you have to see this", "Honestly?"). Never open with a generic greeting like "Hi guys" or "Have you ever wondered".
4. Never mention "selfie", "phone", or "camera" — how the shot is framed is handled elsewhere in the pipeline; naming it breaks the illusion.
5. Hit the target length exactly — it's not a suggestion. A script outside its bracket gets clipped or awkwardly padded by the renderer.
6. Weave in real specifics from the pitch (a name, one concrete detail or benefit) rather than staying generic — specificity is what makes a UGC-style ad feel real and makes it convert.
7. Wrap ONLY the final spoken script in <script></script> tags, with nothing else inside them — no stage directions, no labels. If you need to reason about word count or phrasing first, do that BEFORE the tags; nothing outside the tags is read, but everything inside must be exactly what gets spoken.

Respond in this exact shape:
<script>
(the spoken script goes here, and only here)
</script>`;

interface DraftOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The shared core of drafting a script from a pitch: build the user
 * message, run the primary-then-fallback model attempt, extract the
 * <script> tag. Extracted out of draftScriptRoute (unchanged behavior)
 * so draftScriptFromUrlRoute can reuse the exact same drafting logic and
 * SYSTEM_PROMPT against a pitch it synthesizes from an extracted brand
 * kit instead of one the user typed -- see buildPitchFromBrand below.
 * Returns a response descriptor rather than writing to `res` directly so
 * both callers can still add their own fields (e.g. draft-from-url's
 * `source`) on top of a successful result.
 */
async function draftScriptFromPitch(
  pitch: string,
  target_duration: '5' | '10' | '15' | 'auto',
  look: 'natural' | 'commercial' | 'raw_iphone' | undefined,
  tone_notes: string | undefined,
  routeNameForAlert: string,
): Promise<DraftOutcome> {
  const userMessageParts = [
    `Pitch: ${pitch.trim()}`,
    `Target length: ${WORD_BRACKET[target_duration]}`,
  ];
  if (look) userMessageParts.push(`Look/tone: ${LOOK_GUIDANCE[look]}`);
  if (tone_notes?.trim()) userMessageParts.push(`Extra guidance: ${tone_notes.trim()}`);
  userMessageParts.push('Write the script now.');

  const userMessage = userMessageParts.join('\n');

  let rawText: string;
  try {
    rawText = await attemptDraft(MODEL, DRAFT_TIMEOUT_MS, userMessage);
  } catch (primaryErr) {
    const primaryDetail = primaryErr instanceof DraftAttemptError ? primaryErr.body.error.code : 'unknown';
    // eslint-disable-next-line no-console
    console.warn(
      `[${routeNameForAlert}] primary model (${MODEL}) failed (${primaryDetail}: ${(primaryErr as Error).message}) -- retrying once with fallback model ${FALLBACK_MODEL}`,
    );
    try {
      rawText = await attemptDraft(FALLBACK_MODEL, FALLBACK_TIMEOUT_MS, userMessage);
    } catch (fallbackErr) {
      captureAiRouteFailure(routeNameForAlert, fallbackErr, {
        primaryModel: MODEL,
        fallbackModel: FALLBACK_MODEL,
      });
      if (fallbackErr instanceof DraftAttemptError) {
        if (fallbackErr.httpStatus === 504) {
          return {
            status: 504,
            body: {
              error: {
                code: 'UPSTREAM_TIMEOUT',
                message:
                  'The AI script writer took too long to respond, even after automatically retrying with a faster fallback model — please try again in a moment.',
              },
            },
          };
        }
        return { status: fallbackErr.httpStatus, body: fallbackErr.body };
      }
      return { status: 502, body: { error: { code: 'UPSTREAM_ERROR', message: (fallbackErr as Error).message } } };
    }
  }

  // Pull ONLY what's inside <script>…</script> — this is what actually
  // keeps a model's inline reasoning (word-counting, draft attempts, "Let's
  // try...") out of the result, regardless of whether it obeyed the "only
  // the script text" instruction on its own. A raw dump of that reasoning
  // was reaching make_ugc's script field (>1200 chars, tripping its Zod
  // max length) before this tag existed.
  const tagMatch = rawText.match(/<script>([\s\S]*?)<\/script>/i);
  const script = (tagMatch ? tagMatch[1] : rawText)
    .trim()
    // Strip a wrapping quote pair if the model added one despite instructions.
    .replace(/^["“"](.*)["”"]$/s, '$1')
    .trim();

  if (!script) {
    return { status: 502, body: { error: { code: 'EMPTY_RESULT', message: 'The model returned an empty script — try again.' } } };
  }

  // Sanity guard for the no-tag fallback path: a real script for this
  // prompt is at most ~35 words (see WORD_BRACKET). Anything wildly longer
  // is reasoning that leaked through without the tag, not a script — fail
  // loudly instead of handing the caller something make_ugc will 400 on.
  const MAX_PLAUSIBLE_SCRIPT_CHARS = 500;
  if (!tagMatch && script.length > MAX_PLAUSIBLE_SCRIPT_CHARS) {
    return {
      status: 502,
      body: {
        error: {
          code: 'DRAFT_LOOKS_LIKE_REASONING',
          message: 'The draft came back malformed (looked like reasoning, not a script) — try again.',
        },
      },
    };
  }

  return { status: 200, body: { script } };
}

export async function draftScriptRoute(req: Request, res: ExpressResponse): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const parsed = DraftScriptRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
        issues: parsed.error.issues,
      },
    });
    return;
  }
  const { pitch, target_duration, look, tone_notes } = parsed.data;
  const outcome = await draftScriptFromPitch(pitch, target_duration, look, tone_notes, 'assist.draft-script');
  res.status(outcome.status).json(outcome.body);
}


const DraftScriptFromUrlRequestSchema = z.object({
  url: z.string().url().max(2000).describe('A public product/landing page URL to draft an ad from.'),
  target_duration: z.enum(['5', '10', '15', 'auto']).default('auto'),
  look: z.enum(['natural', 'commercial', 'raw_iphone']).optional(),
  tone_notes: z.string().max(200).optional().describe('Optional extra guidance, e.g. brand voice, a phrase to include, an audience.'),
});

/**
 * Synthesizes the same "Pitch: ..." line draftScriptFromPitch expects from
 * an extracted brand kit — capped to DraftScriptRequestSchema's own 400-char
 * pitch limit so a URL-sourced pitch behaves exactly like a user-typed one
 * downstream. Pure (no I/O), so it's unit-testable without a live brand-
 * extractor call. Returns null when the page yielded nothing usable (no
 * brand_name/title/description/hero at all) — an empty/garbage pitch would
 * just produce a garbage script, so the caller should fail clearly instead
 * of drafting from nothing.
 */
export function buildPitchFromBrand(
  brand: Pick<ExtractedBrand, 'brand_name' | 'title' | 'description' | 'hero'>,
): string | null {
  const name = brand.brand_name?.trim() || brand.title?.trim() || null;
  const detail = brand.description?.trim() || brand.hero?.trim() || null;
  if (!name && !detail) return null;
  return [name, detail].filter(Boolean).join(': ').slice(0, 400);
}

export async function draftScriptFromUrlRoute(req: Request, res: ExpressResponse): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const parsed = DraftScriptFromUrlRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
        issues: parsed.error.issues,
      },
    });
    return;
  }
  const { url, target_duration, look, tone_notes } = parsed.data;

  let brand: ExtractedBrand;
  try {
    brand = await extractBrandFromUrl(url, `draft-from-url-${userId}-${Date.now()}`);
  } catch (err) {
    if (err instanceof BrandExtractorNotConfiguredError) {
      res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: err.message } });
      return;
    }
    if (err instanceof BrandExtractionFailedError) {
      res.status(err.status).json({
        error: { code: 'EXTRACTION_FAILED', message: `Could not read that page: ${err.message}` },
      });
      return;
    }
    captureAiRouteFailure('assist.draft-script-from-url', err, { url });
    res.status(502).json({
      error: { code: 'EXTRACTION_FAILED', message: err instanceof Error ? err.message : 'brand extraction failed' },
    });
    return;
  }

  const pitch = buildPitchFromBrand(brand);
  if (!pitch) {
    res.status(422).json({
      error: {
        code: 'NOTHING_TO_DRAFT_FROM',
        message:
          "That page didn't have enough on it (no title, description, or heading) to draft a script from — try writing a pitch directly instead.",
      },
    });
    return;
  }

  const outcome = await draftScriptFromPitch(pitch, target_duration, look, tone_notes, 'assist.draft-script-from-url');
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body);
    return;
  }

  // Candidate product images + brand context ride alongside the script so
  // the caller can show "drafted from <url>" with a picker for the actual
  // product photo — see this file's header comment for why that picker is
  // mandatory, not auto-resolved.
  res.status(200).json({
    ...outcome.body,
    source: {
      url: brand.url,
      title: brand.title,
      description: brand.description,
      brand_name: brand.brand_name,
      image: brand.image,
      screenshot: brand.screenshot,
      product_image_candidates: brand.product_image_candidates,
      logo: brand.logo,
      palette: brand.palette,
    },
  });
}
