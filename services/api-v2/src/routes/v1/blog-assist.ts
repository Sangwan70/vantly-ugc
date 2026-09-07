// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/assist/draft-blog-post
 *
 * Admin-only. Turns one of the ADMIN'S OWN past generations — a video,
 * image, or storyboard produced by any skill/primitive — into a ~500-word
 * blog post draft, grounded in whatever the run actually used (its script/
 * story/character artefacts, not just the short prompt shown in the
 * gallery). Used by the Blog admin editor's "Generate from a generation"
 * picker (see apps/web/.../dashboard/admin/blog/page.tsx).
 *
 * Scoped to the caller's own user_id on every lookup, same as every other
 * per-user table read in this service — an admin drafting a blog post
 * about a customer's private generation without consent is exactly the
 * kind of cross-account access this guards against; admins can only draft
 * from generations they made themselves (e.g. demo/example runs).
 *
 * Reuses the same Anthropic call path as draft-script (callAnthropicMessages)
 * — no new provider wiring.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { callAnthropicMessages } from '../../lib/anthropic-client.js';
import { isAdminEmail } from '../../lib/admin-allowlist.js';
import { supabase } from '../../server.js';

const MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6';

const DraftBlogPostRequestSchema = z.object({
  source: z.enum(['legacy', 'vnext_skill', 'vnext_primitive']),
  run_id: z.string().uuid(),
});

// Only the tags the admin blog editor's sanitizer (sanitizeStaticPageHtml,
// apps/web/lib/content/sanitize-html.ts) actually keeps — anything else the
// model writes gets stripped at save time anyway, so constraining the ask
// up front avoids a draft that reads worse after sanitization than before.
const SYSTEM_PROMPT = `You are a content marketer writing a blog post for Vantly UGC, an AI video/image generation platform, to showcase something the team generated with it.

You will be given the concrete details of ONE real generation: what was asked for (a script, a story, character descriptions, a skill name) and what it produced. Write a blog post that shows this off to potential customers — engaging, concrete, grounded in the actual details given. Never invent details that weren't provided; if something is thin, write around it rather than fabricating specifics.

Rules:
1. Length: about 500 words for the body (not counting the title).
2. Output EXACTLY this format, nothing before or after it:
TITLE: <one line, no surrounding quotes>
EXCERPT: <one or two sentences, no surrounding quotes>
BODY:
<the post body as simple HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>. No <html>/<head>/<body>, no inline styles, no images, no links, no markdown syntax.>
3. Tone: confident and specific, like a real case study — not generic marketing fluff ("elevate", "seamless", "game-changer", "unlock", "revolutionize").
4. Structure the body with 2-4 short sections using <h2> subheadings, not one long wall of text.`;

interface RunContext {
  skillOrPrimitive: string;
  details: string[];
  mediaUrl: string | null;
}

async function loadLegacyContext(userId: string, runId: string): Promise<RunContext | null> {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id, operation, model_slug, prompt, negative_prompt, output_media_url')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const details: string[] = [];
  if (data.prompt) details.push(`Prompt: ${data.prompt}`);
  if (data.negative_prompt) details.push(`Avoided: ${data.negative_prompt}`);
  return {
    skillOrPrimitive: (data.operation as string | null) ?? (data.model_slug as string | null) ?? 'generation',
    details,
    mediaUrl: (data.output_media_url as string | null) ?? null,
  };
}

/** Flattens whatever shape a run's `input` jsonb happens to have (script,
 *  scenes[], characters[], person, description, ...) into readable lines —
 *  every skill's input schema is different, so this stays generic rather
 *  than hardcoding one skill's field names. */
function describeInput(input: unknown, lines: string[], prefix = ''): void {
  if (input == null) return;
  if (typeof input === 'string') {
    if (input.trim()) lines.push(`${prefix}${input.trim()}`);
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((v, i) => describeInput(v, lines, `${prefix}[${i}] `));
    return;
  }
  if (typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k.endsWith('_base64') || k.endsWith('_url') || k === 'ref_base64') continue; // skip binary/URL noise
      if (typeof v === 'string' && v.trim()) lines.push(`${prefix}${k}: ${v.trim()}`);
      else if (typeof v === 'object' && v !== null) describeInput(v, lines, `${prefix}${k}.`);
    }
  }
}

async function loadSkillRunContext(userId: string, runId: string): Promise<RunContext | null> {
  const { data, error } = await supabase
    .from('skill_runs')
    .select('id, skill_slug, input, final_output')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const details: string[] = [];
  describeInput(data.input, details);
  const out = (data.final_output as Record<string, unknown> | null) ?? {};
  const mediaUrl = (out.video_url as string) ?? (out.character_sheet_url as string) ?? (out.portrait_url as string) ?? null;
  return { skillOrPrimitive: data.skill_slug as string, details, mediaUrl };
}

async function loadPrimitiveContext(userId: string, runId: string): Promise<RunContext | null> {
  const { data, error } = await supabase
    .from('primitive_runs')
    .select('id, primitive_id, input, primitive_artifacts(url)')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const details: string[] = [];
  describeInput(data.input, details);
  const artifacts = (data.primitive_artifacts as Array<{ url: string }> | null) ?? [];
  return { skillOrPrimitive: data.primitive_id as string, details, mediaUrl: artifacts[0]?.url ?? null };
}

export async function draftBlogPostRoute(req: Request, res: ExpressResponse): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  const userEmail = (req as { userEmail?: string }).userEmail;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }
  if (!isAdminEmail(userEmail)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    return;
  }

  const parsed = DraftBlogPostRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request' } });
    return;
  }
  const { source, run_id } = parsed.data;

  const ctx = source === 'legacy'
    ? await loadLegacyContext(userId, run_id)
    : source === 'vnext_skill'
    ? await loadSkillRunContext(userId, run_id)
    : await loadPrimitiveContext(userId, run_id);
  if (!ctx) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Generation not found (or not yours)' } });
    return;
  }

  const userMessageParts = [
    `Skill/primitive used: ${ctx.skillOrPrimitive}`,
    ctx.details.length > 0 ? `What was asked for:\n${ctx.details.join('\n')}` : 'No further input details were recorded for this run.',
    ctx.mediaUrl ? 'The run produced a finished video/image (do not fabricate what it looks like beyond what the input details say — describe the creative intent, not invented visual specifics).' : '',
    'Write the blog post now, in the exact TITLE/EXCERPT/BODY format specified.',
  ].filter(Boolean);

  let upstream: globalThis.Response;
  try {
    upstream = await callAnthropicMessages(
      {
        model: MODEL,
        max_tokens: 1600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessageParts.join('\n\n') }],
      },
      { signal: AbortSignal.timeout(45_000) },
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

  const raw = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim();

  const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
  const excerptMatch = raw.match(/^EXCERPT:\s*(.+)$/m);
  const bodyMatch = raw.match(/^BODY:\s*([\s\S]*)$/m);

  const title = titleMatch?.[1]?.trim().replace(/^["“](.*)["”]$/s, '$1').trim();
  const excerpt = excerptMatch?.[1]?.trim().replace(/^["“](.*)["”]$/s, '$1').trim();
  const content_html = bodyMatch?.[1]?.trim();

  if (!title || !content_html) {
    res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The model returned an unexpected format — try again.' } });
    return;
  }

  res.status(200).json({ title, excerpt: excerpt ?? '', content_html });
}
