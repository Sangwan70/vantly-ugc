// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/assist/draft-podcast
 * POST /v1/assist/draft-storybook
 *
 * "Bare minimum: type a prompt and let the system generate the rest" for
 * the agent composer's Podcast and Storybook forms — draft-podcast turns a
 * topic (+ optional reference URL + discussion orientation) into a full
 * A/B conversation for make_podcast's `script` field; draft-storybook
 * turns a premise (+ optional reference URL) into a cast + ordered scenes
 * for make_storybook's `characters`/`scenes` fields. Both routes ALWAYS
 * return their result into the caller's normal editable form fields (via
 * the frontend's onChangeAny) rather than auto-submitting a run — same
 * human-in-the-loop principle as draft-script/draft-script-from-url in
 * assist.ts, whose primary+fallback model call path
 * (attemptDraft/DraftAttemptError/MODEL/FALLBACK_MODEL) this file reuses
 * directly instead of re-implementing it.
 *
 * Reference-URL text (lib/url-text-fetcher.ts) and web search
 * (lib/web-search-client.ts) are both OPTIONAL enrichment: a missing/failed
 * fetch or an unconfigured search provider never fails the draft, it just
 * degrades to drafting from the topic/premise text alone (see
 * gatherContext below) -- web search in particular has no provider wired
 * up yet anywhere in this codebase, so WebSearchNotConfiguredError is the
 * expected state until WEB_SEARCH_PROVIDER + the matching API key are set.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import {
  MODEL,
  FALLBACK_MODEL,
  DraftAttemptError,
  attemptDraft,
  isTimeoutError,
} from './assist.js';
import { captureAiRouteFailure } from '../../lib/ai-route-alert.js';
import { webSearch, WebSearchNotConfiguredError, type WebSearchResult } from '../../lib/web-search-client.js';
import { fetchUrlText } from '../../lib/url-text-fetcher.js';
import { PODCAST_MAX_TURNS } from '../../skills/registry.js';
import { STORYBOOK_MAX_CHARACTERS, STORYBOOK_MAX_SCENES } from '@vantly-ugc/schema';
import { callOpenRouterChatCompletion } from '../../lib/openrouter-chat.js';
import { currentModelProvider } from '../../lib/anthropic-client.js';

// draft-script's DRAFT_TIMEOUT_MS/FALLBACK_TIMEOUT_MS (45s/20s) were tuned
// for a ~35-word script. These two routes write far more (up to 16 dialogue
// turns, or a 1-4 character cast + up to 12 scenes) -- a real generation
// legitimately takes longer, and the smaller budget was hitting "took too
// long to respond, even after automatically retrying with a faster
// fallback model" on ordinary requests, not just slow ones. Give both
// attempts more room before giving up.
const COMPOSE_DRAFT_TIMEOUT_MS = 75_000;
const COMPOSE_FALLBACK_TIMEOUT_MS = 40_000;

// Output-length ceilings passed to attemptDraft's maxTokens (default 700,
// sized for draft-script). Podcast tops out at PODCAST_MAX_TURNS (24) turns
// of dialogue; storybook at a 4-character cast + STORYBOOK_MAX_SCENES (12)
// scenes, each with a line AND a visual description -- both need
// meaningfully more headroom, plus the same inline-reasoning buffer
// attemptDraft's own comment describes for models that think before the
// tag.
const PODCAST_DRAFT_MAX_TOKENS = 1600;
const STORYBOOK_DRAFT_MAX_TOKENS = 2400;

// Text-generation-only model switch (titles/story/dialogue): when
// MODEL_PROVIDER=openrouter, draft-podcast/draft-storybook route through
// OpenRouter's OpenAI-compatible /api/v1/chat/completions endpoint (see
// lib/openrouter-chat.ts's header comment for why -- in short, the
// Anthropic-Messages-compatible endpoint callAnthropicMessages/attemptDraft
// use is only guaranteed reliable for Claude models, not these free ones)
// using two genuinely different free models rather than reusing whatever
// single model OPENROUTER_MODEL happens to be pinned to elsewhere in the
// app. Both overridable per-deployment; defaults are free-tier OpenRouter
// slugs confirmed live as of Sept 2026.
const FREE_MODEL = process.env.ASSIST_COMPOSE_FREE_MODEL || 'deepseek/deepseek-v4-flash-0731:free';
const FREE_FALLBACK_MODEL = process.env.ASSIST_COMPOSE_FREE_FALLBACK_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';

// ── Shared: gather optional context, run primary+fallback model ──────────

interface GatheredContext {
  searchResults: WebSearchResult[];
  warnings: string[];
  usedReferenceUrl: boolean;
}

/** Reference-URL text + web search, both best-effort. Never throws -- a
 *  failure on either becomes a `warnings` entry and the draft proceeds
 *  without it, since something usable (drafted from the topic/premise
 *  alone) beats failing the whole request over an optional enrichment. */
async function gatherContext(query: string, sourceUrl: string | undefined): Promise<{ ctx: GatheredContext; referenceText: string | null }> {
  const warnings: string[] = [];
  let referenceText: string | null = null;
  if (sourceUrl) {
    try {
      referenceText = await fetchUrlText(sourceUrl);
    } catch (err) {
      warnings.push(`Couldn't read the reference URL (${(err as Error).message}) — drafted without it.`);
    }
  }
  let searchResults: WebSearchResult[] = [];
  try {
    searchResults = await webSearch(query, { maxResults: 5 });
  } catch (err) {
    if (!(err instanceof WebSearchNotConfiguredError)) {
      warnings.push(`Web search failed (${(err as Error).message}) — drafted without it.`);
    }
  }
  return { ctx: { searchResults, warnings, usedReferenceUrl: referenceText !== null }, referenceText };
}

function formatContextBlock(referenceText: string | null, searchResults: WebSearchResult[]): string {
  const parts: string[] = [];
  if (referenceText) parts.push(`Reference page content:\n${referenceText.slice(0, 4000)}`);
  if (searchResults.length) {
    const lines = searchResults.map((r) => `- ${r.title}: ${r.snippet} (${r.url})`).join('\n');
    parts.push(`Web research:\n${lines}`);
  }
  return parts.join('\n\n');
}

interface DraftRawOutcome {
  status: number;
  text?: string;
  body?: Record<string, unknown>;
}

/** Same primary-model-then-one-fallback shape as assist.ts's
 *  draftScriptFromPitch, generalized over an arbitrary system prompt so
 *  draft-podcast/draft-storybook can each supply their own instead of
 *  draft-script's SYSTEM_PROMPT. Returns raw model text (not yet tag-
 *  parsed) since the two callers parse completely different tag shapes.
 *  Always calls the Anthropic-Messages-compatible path (Claude direct, or
 *  Claude-via-OpenRouter) -- see draftRawText below for the dispatcher that
 *  picks this vs. the free-OpenRouter-model path. */
async function draftRawTextViaClaude(userMessage: string, systemPrompt: string, routeNameForAlert: string, maxTokens: number): Promise<DraftRawOutcome> {
  try {
    const text = await attemptDraft(MODEL, COMPOSE_DRAFT_TIMEOUT_MS, userMessage, systemPrompt, maxTokens);
    return { status: 200, text };
  } catch (primaryErr) {
    const primaryDetail = primaryErr instanceof DraftAttemptError ? primaryErr.body.error.code : 'unknown';
    // eslint-disable-next-line no-console
    console.warn(
      `[${routeNameForAlert}] primary model (${MODEL}) failed (${primaryDetail}: ${(primaryErr as Error).message}) -- retrying once with fallback model ${FALLBACK_MODEL}`,
    );
    try {
      const text = await attemptDraft(FALLBACK_MODEL, COMPOSE_FALLBACK_TIMEOUT_MS, userMessage, systemPrompt, maxTokens);
      return { status: 200, text };
    } catch (fallbackErr) {
      captureAiRouteFailure(routeNameForAlert, fallbackErr, { primaryModel: MODEL, fallbackModel: FALLBACK_MODEL });
      if (fallbackErr instanceof DraftAttemptError) {
        if (fallbackErr.httpStatus === 504) {
          return {
            status: 504,
            body: {
              error: {
                code: 'UPSTREAM_TIMEOUT',
                message: 'The AI writer took too long to respond, even after automatically retrying with a faster fallback model — please try again in a moment.',
              },
            },
          };
        }
        return { status: fallbackErr.httpStatus, body: fallbackErr.body };
      }
      return { status: 502, body: { error: { code: 'UPSTREAM_ERROR', message: (fallbackErr as Error).message } } };
    }
  }
}

/** attemptDraft's OpenRouter-chat-completions-endpoint counterpart: same
 *  timeout-signal + typed-error shape (DraftAttemptError / isTimeoutError),
 *  just calling callOpenRouterChatCompletion instead of
 *  callAnthropicMessages under the hood, since free (non-Claude) OpenRouter
 *  models need the OpenAI-compatible endpoint to work reliably. */
async function attemptOpenRouterDraft(model: string, timeoutMs: number, userMessage: string, systemPrompt: string, maxTokens: number): Promise<string> {
  try {
    const text = await callOpenRouterChatCompletion(
      { model, system: systemPrompt, userMessage, maxTokens },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return text;
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new DraftAttemptError(504, {
        error: { code: 'UPSTREAM_TIMEOUT', message: `OpenRouter model ${model} timed out after ${timeoutMs}ms` },
      });
    }
    throw new DraftAttemptError(502, {
      error: { code: 'UPSTREAM_ERROR', message: (err as Error).message, detail: model },
    });
  }
}

/** Same primary-then-fallback shape as draftRawTextViaClaude, but over two
 *  free OpenRouter models via the OpenAI-compatible chat-completions
 *  endpoint (lib/openrouter-chat.ts) instead of the Anthropic-Messages
 *  endpoint -- used when MODEL_PROVIDER=openrouter, so "cheapest/free
 *  models to generate the text" doesn't inherit the Claude-only reliability
 *  assumption callAnthropicMessages's /v1/messages route depends on. */
async function draftRawTextViaFreeOpenRouter(userMessage: string, systemPrompt: string, routeNameForAlert: string, maxTokens: number): Promise<DraftRawOutcome> {
  try {
    const text = await attemptOpenRouterDraft(FREE_MODEL, COMPOSE_DRAFT_TIMEOUT_MS, userMessage, systemPrompt, maxTokens);
    return { status: 200, text };
  } catch (primaryErr) {
    const primaryDetail = primaryErr instanceof DraftAttemptError ? primaryErr.body.error.code : 'unknown';
    // eslint-disable-next-line no-console
    console.warn(
      `[${routeNameForAlert}] free model (${FREE_MODEL}) failed (${primaryDetail}: ${(primaryErr as Error).message}) -- retrying once with fallback free model ${FREE_FALLBACK_MODEL}`,
    );
    try {
      const text = await attemptOpenRouterDraft(FREE_FALLBACK_MODEL, COMPOSE_FALLBACK_TIMEOUT_MS, userMessage, systemPrompt, maxTokens);
      return { status: 200, text };
    } catch (fallbackErr) {
      captureAiRouteFailure(routeNameForAlert, fallbackErr, { primaryModel: FREE_MODEL, fallbackModel: FREE_FALLBACK_MODEL });
      if (fallbackErr instanceof DraftAttemptError) {
        if (fallbackErr.httpStatus === 504) {
          return {
            status: 504,
            body: {
              error: {
                code: 'UPSTREAM_TIMEOUT',
                message: 'The AI writer took too long to respond, even after automatically retrying with a fallback model — please try again in a moment.',
              },
            },
          };
        }
        return { status: fallbackErr.httpStatus, body: fallbackErr.body };
      }
      return { status: 502, body: { error: { code: 'UPSTREAM_ERROR', message: (fallbackErr as Error).message } } };
    }
  }
}

/** Dispatcher draft-podcast/draft-storybook actually call: routes to the
 *  free-OpenRouter-model path when the deployment is configured for
 *  OpenRouter (MODEL_PROVIDER=openrouter), Claude otherwise -- same
 *  provider switch lib/anthropic-client.ts's callAnthropicMessages already
 *  respects, kept in sync here rather than introducing a second env var.
 *  Scoped deliberately to just these two routes' title/story/dialogue text
 *  generation; draft-script and the agent chat are unaffected and keep
 *  using the Claude/Anthropic-Messages path via MODEL/FALLBACK_MODEL. */
async function draftRawText(userMessage: string, systemPrompt: string, routeNameForAlert: string, maxTokens: number): Promise<DraftRawOutcome> {
  return currentModelProvider() === 'openrouter'
    ? draftRawTextViaFreeOpenRouter(userMessage, systemPrompt, routeNameForAlert, maxTokens)
    : draftRawTextViaClaude(userMessage, systemPrompt, routeNameForAlert, maxTokens);
}

/** Splits a "field | field | field" line into exactly `parts` fields,
 *  rejoining any extra pipes into the LAST field so a stray "|" inside
 *  dialogue text doesn't silently truncate it. Returns null if the line
 *  doesn't have enough fields to be a real row (e.g. stray prose). */
function splitPipeLine(line: string, parts: number): string[] | null {
  const segments = line.split('|').map((s) => s.trim());
  if (segments.length < parts) return null;
  if (segments.length === parts) return segments;
  const head = segments.slice(0, parts - 1);
  const tail = segments.slice(parts - 1).join(' | ');
  return [...head, tail];
}

// ── POST /v1/assist/draft-podcast ─────────────────────────────────────────

const ORIENTATION_GUIDANCE: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'Both speakers are enthusiastic and upbeat about the topic — they highlight the upside, share genuine excitement, and encourage the listener.',
  negative: 'Both speakers are skeptical or critical of the topic — they raise real concerns, push back on hype, and are honest about what is wrong with it.',
  neutral: 'The speakers present a fair, balanced discussion — they weigh pros and cons without an obvious lean either way.',
};

const PODCAST_SYSTEM_PROMPT = `You write short, natural two-person podcast conversations for a vertical AI-generated video. Given a topic, a discussion orientation, and optional reference material (an article's content and/or web search results), write a realistic back-and-forth conversation between Speaker A and Speaker B.

Rules, in order of importance:
1. Write ONLY what each speaker says aloud — no stage directions, no scene descriptions, no labels beyond "A:" / "B:", no emojis, no hashtags, no surrounding quotation marks.
2. Alternate speakers naturally — mostly back and forth, never more than two turns in a row from the same speaker.
3. Each line is 1-3 sentences a real person would say out loud, at least 8 words — conversational, contractions okay, no marketing jargon.
4. Follow the discussion orientation given below for BOTH speakers' overall stance on the topic.
5. When reference material is given, use its real facts, names and numbers to ground specific claims — never invent statistics that contradict it. When none is given, draw on general knowledge without inventing fake sources or fake stats.
6. Produce between 8 and 16 turns total.
7. Output ONLY inside the tags below — one line per turn, formatted exactly as "A: <line>" or "B: <line>", no blank lines between turns, no markdown, no extra commentary before or after the tags.
8. After the conversation, optionally suggest a one-line studio/setting description inside <room></room> tags (e.g. "a cozy home studio with plants and warm lighting"). Omit the <room> tag entirely if you have no strong suggestion.

Respond in this exact shape:
<conversation>
A: ...
B: ...
</conversation>
<room>...</room>`;

const DraftPodcastRequestSchema = z.object({
  topic: z.string().min(6).max(400).describe('What the two speakers are discussing, e.g. "why cold plunges are overrated".'),
  source_url: z.string().url().max(2000).optional().describe('Optional article/blog/page URL to research and ground the conversation in.'),
  orientation: z.enum(['positive', 'negative', 'neutral']).default('neutral').describe("The discussion's overall lean."),
});

function parsePodcastDraft(rawText: string): { turns: Array<{ speaker: 'A' | 'B'; line: string }>; room?: string } {
  const convoMatch = rawText.match(/<conversation>([\s\S]*?)<\/conversation>/i);
  const body = convoMatch ? convoMatch[1] : rawText;
  const turns: Array<{ speaker: 'A' | 'B'; line: string }> = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([AB])\s*:\s*(.+)$/);
    if (!m) continue;
    const text = m[2].trim().replace(/^["“](.*)["”]$/s, '$1').trim();
    if (!text) continue;
    turns.push({ speaker: m[1] as 'A' | 'B', line: text });
    if (turns.length >= PODCAST_MAX_TURNS) break;
  }
  const roomMatch = rawText.match(/<room>([\s\S]*?)<\/room>/i);
  const room = roomMatch ? roomMatch[1].trim() : '';
  return { turns, room: room || undefined };
}

export async function draftPodcastRoute(req: Request, res: ExpressResponse): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const parsed = DraftPodcastRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request', issues: parsed.error.issues },
    });
    return;
  }
  const { topic, source_url, orientation } = parsed.data;

  const { ctx, referenceText } = await gatherContext(topic, source_url);
  const userMessageParts = [`Topic: ${topic.trim()}`, `Discussion orientation: ${ORIENTATION_GUIDANCE[orientation]}`];
  const context = formatContextBlock(referenceText, ctx.searchResults);
  if (context) userMessageParts.push(context);
  userMessageParts.push('Write the conversation now.');

  const outcome = await draftRawText(userMessageParts.join('\n\n'), PODCAST_SYSTEM_PROMPT, 'assist.draft-podcast', PODCAST_DRAFT_MAX_TOKENS);
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body ?? { error: { code: 'UPSTREAM_ERROR', message: 'draft failed' } });
    return;
  }
  // A "successful" (200) call can still come back with empty text -- e.g.
  // the model returned only a non-text block, or nothing at all. Bug fixed
  // here: this used to fall into the same branch as a real failure but
  // WITHOUT overriding outcome.status (still 200), so the caller got a 200
  // response with an {error:...} body -- confusing on its own, and it
  // meant the frontend's `if (!resp.ok)` check never even fired. Give it
  // its own real error status instead.
  if (!outcome.text) {
    res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The AI writer returned an empty response — try again.' } });
    return;
  }

  const { turns, room } = parsePodcastDraft(outcome.text);
  if (turns.length < 2) {
    res.status(502).json({
      error: { code: 'EMPTY_RESULT', message: 'The AI writer returned an unusable conversation — try again or rephrase the topic.' },
    });
    return;
  }

  res.status(200).json({
    turns,
    room,
    warnings: ctx.warnings.length ? ctx.warnings : undefined,
    searched: ctx.searchResults.length > 0,
  });
}

// ── POST /v1/assist/draft-storybook ───────────────────────────────────────

const STORYBOOK_SYSTEM_PROMPT = `You write short illustrated-story casts and scene scripts for a vertical AI-generated video. Given a premise and optional reference material (an article's content and/or web search results), invent a small cast of characters and an ordered sequence of scenes where each scene's character speaks on-screen.

Rules, in order of importance:
1. Invent characters as instructed below (a cast size may be specified; otherwise pick whatever is right for the story, usually 2-3). Give each a short name as it would appear in the story, and a physical-look + personality description (what an illustrator needs to design them consistently — species/age/build, clothing or notable features, a couple of personality words). 10-40 words per description.
2. Invent between 5 and 8 scenes, in story order. Every scene's speaker must be one of the character names, written EXACTLY as it appears in the characters list. Each scene's line is 1-2 sentences that character says aloud (dialogue or narration), at least 8 words. Each scene's visual description is what the shot shows: the setting, the character's action, and their expression — enough for an illustrator to draw it, 8-30 words.
3. When reference material is given, ground the premise's real facts/names/numbers in it. When none is given, invent a self-contained, family-friendly story from the premise alone.
4. No stage directions inside dialogue lines, no emojis, no markdown.
5. Optionally suggest a short story title inside <title></title>. Omit it if nothing fits well.
6. Output ONLY inside the tags below, nothing before or after them. In <characters>, one character per line, formatted exactly as "Name | description". In <scenes>, one scene per line, formatted exactly as "Speaker | line | visual description" (speaker must match a name from <characters> exactly).

Respond in this exact shape:
<title>...</title>
<characters>
Name | description
</characters>
<scenes>
Speaker | line | visual description
</scenes>`;

const DraftStorybookRequestSchema = z.object({
  premise: z.string().min(6).max(400).describe('What the story is about, e.g. "a shy fox who learns to make friends at a forest picnic".'),
  source_url: z.string().url().max(2000).optional().describe('Optional article/blog/page URL to research and ground the story in.'),
  character_count: z
    .number()
    .int()
    .min(1)
    .max(STORYBOOK_MAX_CHARACTERS)
    .optional()
    .describe('Optional desired cast size; the writer picks a sensible size (usually 2-3) if omitted.'),
});

function parseStorybookDraft(rawText: string): {
  title?: string;
  characters: Array<{ name: string; description: string }>;
  scenes: Array<{ speaker: string; line: string; visual_description: string }>;
} {
  const titleMatch = rawText.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const characters: Array<{ name: string; description: string }> = [];
  const charsMatch = rawText.match(/<characters>([\s\S]*?)<\/characters>/i);
  if (charsMatch) {
    for (const rawLine of charsMatch[1].split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = splitPipeLine(line, 2);
      if (!parts) continue;
      const [name, description] = parts;
      if (name && description) characters.push({ name, description });
      if (characters.length >= STORYBOOK_MAX_CHARACTERS) break;
    }
  }

  const scenes: Array<{ speaker: string; line: string; visual_description: string }> = [];
  const scenesMatch = rawText.match(/<scenes>([\s\S]*?)<\/scenes>/i);
  if (scenesMatch) {
    for (const rawLine of scenesMatch[1].split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = splitPipeLine(line, 3);
      if (!parts) continue;
      const [speaker, dialogue, visual] = parts;
      if (speaker && dialogue && visual) scenes.push({ speaker, line: dialogue, visual_description: visual });
      if (scenes.length >= STORYBOOK_MAX_SCENES) break;
    }
  }

  return { title: title || undefined, characters, scenes };
}

export async function draftStorybookRoute(req: Request, res: ExpressResponse): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const parsed = DraftStorybookRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request', issues: parsed.error.issues },
    });
    return;
  }
  const { premise, source_url, character_count } = parsed.data;

  const { ctx, referenceText } = await gatherContext(premise, source_url);
  const userMessageParts = [`Premise: ${premise.trim()}`];
  if (character_count) userMessageParts.push(`Cast size: exactly ${character_count} character${character_count === 1 ? '' : 's'}.`);
  const context = formatContextBlock(referenceText, ctx.searchResults);
  if (context) userMessageParts.push(context);
  userMessageParts.push('Write the cast and scenes now.');

  const outcome = await draftRawText(userMessageParts.join('\n\n'), STORYBOOK_SYSTEM_PROMPT, 'assist.draft-storybook', STORYBOOK_DRAFT_MAX_TOKENS);
  if (outcome.status !== 200) {
    res.status(outcome.status).json(outcome.body ?? { error: { code: 'UPSTREAM_ERROR', message: 'draft failed' } });
    return;
  }
  // See the identical fix in draftPodcastRoute above: a 200 with empty text
  // used to be reported to the caller as status 200 with an error body.
  if (!outcome.text) {
    res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The AI writer returned an empty response — try again.' } });
    return;
  }

  const { title, characters, scenes } = parseStorybookDraft(outcome.text);
  if (characters.length === 0 || scenes.length === 0) {
    res.status(502).json({
      error: { code: 'EMPTY_RESULT', message: 'The AI writer returned an unusable story — try again or rephrase the premise.' },
    });
    return;
  }

  // Every scene's speaker must match a character name exactly (mirrors
  // MakeStorybookSkillInputSchema's own refine) -- drop any that don't
  // rather than handing the caller a set that will 400 at submit time.
  const names = new Set(characters.map((c) => c.name));
  const validScenes = scenes.filter((s) => names.has(s.speaker));
  if (validScenes.length === 0) {
    res.status(502).json({
      error: { code: 'EMPTY_RESULT', message: 'The AI writer returned scenes that did not match its own cast — try again.' },
    });
    return;
  }

  res.status(200).json({
    title,
    characters,
    scenes: validScenes,
    warnings: ctx.warnings.length ? ctx.warnings : undefined,
    searched: ctx.searchResults.length > 0,
  });
}
