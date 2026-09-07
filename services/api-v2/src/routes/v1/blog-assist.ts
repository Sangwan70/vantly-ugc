// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/assist/draft-blog-post
 *
 * Admin-only. Turns one of the ADMIN'S OWN past generations — specifically
 * a generated VIDEO (portraits/character-sheet stills and other images
 * don't make sense as "the subject of a blog post" the way a finished UGC
 * video does) — into a ~500-word blog post draft, grounded in the video's
 * own prompt/script/story/character input, and returns content_html with
 * the actual video already embedded at the top via a real <video><source>
 * element (see lib/content/sanitize-html.ts's BLOG_ALLOWED_TAGS and
 * apps/web/lib/content/builder/VideoExtension.ts on the apps/web side for
 * how that tag survives sanitization and the Visual editor). The embed is
 * built here, server-side, from the real DB-recorded media_url — never
 * left to the model to write out, so it can't hallucinate a wrong URL.
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

// Same convention dashboard/social/page.tsx and /v1/me/gallery's own
// media=video filter use to tell a video URL from an image one.
const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?|$|#)/i;

// Only the tags the admin blog editor's sanitizer (sanitizeBlogPostHtml,
// apps/web/lib/content/sanitize-html.ts) actually keeps — anything else the
// model writes gets stripped at save time anyway, so constraining the ask
// up front avoids a draft that reads worse after sanitization than before.
const SYSTEM_PROMPT = `You are a content marketer writing a blog post for Vantly UGC, an AI video generation platform, to showcase a video the team generated with it.

You will be given the concrete details of ONE real generated video: what was asked for (a script, a story, character descriptions, a skill name) — not what it looks like. Write a blog post that shows this off to potential customers — engaging, concrete, grounded in the actual details given. Never invent details that weren't provided; if something is thin, write around it rather than fabricating specifics.

The actual generated video will be embedded automatically directly above your post body, so the reader watches it before reading — you can refer to it naturally ("the video above", "watch it in action"), but never describe specific visual details (camera angles, colors, faces, settings) beyond what the input details explicitly say, since you cannot actually see the video.

Rules:
1. Length: about 500 words for the body (not counting the title).
2. Output EXACTLY this format, nothing before or after it:
TITLE: <one line, no surrounding quotes>
EXCERPT: <one or two sentences, no surrounding quotes>
BODY:
<the post body as simple HTML using only these tags: <p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>. No <html>/<head>/<body>, no video/img/link tags (the video is inserted for you), no inline styles, no markdown syntax.>
3. Tone: confident and specific, like a real case study — not generic marketing fluff ("elevate", "seamless", "game-changer", "unlock", "revolutionize").
4. Structure the body with 2-4 short sections using <h2> subheadings, not one long wall of text.`;

interface RunContext {
  skillOrPrimitive: string;
  details: string[];
  mediaUrl: string | null;
  posterUrl: string | null;
}

async function loadLegacyContext(userId: string, runId: string): Promise<RunContext | null> {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id, operation, model_slug, prompt, negative_prompt, output_media_url, output_thumbnail_url')
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
    posterUrl: (data.output_thumbnail_url as string | null) ?? null,
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
  const mediaUrl = (out.video_url as string) ?? null;
  const posterUrl = (out.character_sheet_url as string) ?? (out.portrait_url as string) ?? null;
  return { skillOrPrimitive: data.skill_slug as string, details, mediaUrl, posterUrl };
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
  return { skillOrPrimitive: data.primitive_id as string, details, mediaUrl: artifacts[0]?.url ?? null, posterUrl: null };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds the actual <video> embed from the run's real, DB-recorded URL —
 *  never generated by the model, so it can't be wrong or hallucinated. */
function buildVideoEmbedHtml(mediaUrl: string, posterUrl: string | null): string {
  const posterAttr = posterUrl ? ` poster="${escapeAttr(posterUrl)}"` : '';
  return `<video controls playsinline preload="metadata"${posterAttr} style="width:100%;border-radius:12px;background-color:#000"><source src="${escapeAttr(mediaUrl)}"></video>`;
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
  if (!ctx.mediaUrl || !VIDEO_EXT_RE.test(ctx.mediaUrl)) {
    res.status(400).json({ error: { code: 'NOT_A_VIDEO', message: 'This generation has no video to embed — pick a generated video.' } });
    return;
  }
  const videoUrl = ctx.mediaUrl;
  const posterUrl = ctx.posterUrl;

  const userMessageParts = [
    `Skill/primitive used: ${ctx.skillOrPrimitive}`,
    ctx.details.length > 0 ? `What was asked for:\n${ctx.details.join('\n')}` : 'No further input details were recorded for this run.',
    'Write the blog post now, in the exact TITLE/EXCERPT/BODY format specified.',
  ];

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
  const modelBody = bodyMatch?.[1]?.trim();

  if (!title || !modelBody) {
    res.status(502).json({ error: { code: 'EMPTY_RESULT', message: 'The model returned an unexpected format — try again.' } });
    return;
  }

  const content_html = `${buildVideoEmbedHtml(videoUrl, posterUrl)}\n${modelBody}`;

  res.status(200).json({ title, excerpt: excerpt ?? '', content_html });
}
