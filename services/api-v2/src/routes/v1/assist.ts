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
 */

import type { Request, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { callAnthropicMessages } from '../../lib/anthropic-client.js';

const MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6';

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
7. Output the script text and only the script text — nothing before or after it.`;

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

  const userMessageParts = [
    `Pitch: ${pitch.trim()}`,
    `Target length: ${WORD_BRACKET[target_duration]}`,
  ];
  if (look) userMessageParts.push(`Look/tone: ${LOOK_GUIDANCE[look]}`);
  if (tone_notes?.trim()) userMessageParts.push(`Extra guidance: ${tone_notes.trim()}`);
  userMessageParts.push('Write the script now.');

  let upstream: globalThis.Response;
  try {
    upstream = await callAnthropicMessages(
      {
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessageParts.join('\n') }],
      },
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch (err) {
    res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } });
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: `Model call failed (${upstream.status})`, detail: text.slice(0, 500) } });
    return;
  }

  let data: { content?: Array<{ type?: string; text?: string }> };
  try {
    data = (await upstream.json()) as typeof data;
  } catch {
    res.status(502).json({ error: { code: 'UPSTREAM_ERROR', message: 'Model returned an unparseable response' } });
    return;
  }

  const script = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim()
    // Strip a wrapping quote pair if the model added one despite instructions.
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();

  if (!script) {
    res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The model returned an empty script — try again.' } });
    return;
  }

  res.status(200).json({ script });
}
