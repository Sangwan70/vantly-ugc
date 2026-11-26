// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — production features.
 *
 *   Templates     GET/POST /v1/studio/templates · DELETE /v1/studio/templates/:id
 *                 POST /v1/studio/projects/:id/apply-template
 *   Localize      POST /v1/studio/projects/:id/localize        → translated copy of the project
 *   Assist        POST /v1/studio/assist/shorten               → narration that fits a slot
 *   Automate      POST /v1/studio/automate                     → recording + script → video(s)
 *                 POST /internal/studio/automate-step          (worker → api, x-internal-secret)
 *   Review        POST /v1/studio/projects/:id/review          submit · approve · request_changes
 *   Comments      GET/POST /v1/studio/projects/:id/comments · PATCH/DELETE /v1/studio/comments/:id
 *   Consent       GET/POST /v1/studio/consents · DELETE /v1/studio/consents/:id
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  cardStingLength,
  CardSchema,
  StudioTtsRequestSchema,
  VoiceBlockSchema,
  VoiceoverTimelineSchema,
  applySuggestions,
  autoSpaceTimelineBlocks,
  parseNarrationScript,
  blockPlayLength,
  clipStarts,
  quoteVoiceoverRenderCredits,
  quoteVoiceoverTtsCredits,
  timelineDuration,
  type EditSuggestionLike,
  type VoiceoverTimeline,
} from '@vantly-ugc/schema';
import { supabase } from '../../server.js';
import { callAnthropicMessages, hasProviderCredential } from '../../lib/anthropic-client.js';
import { isAdminEmail } from '../../lib/admin-allowlist.js';
import { isBillingEnabled } from './skills.js';
import {
  StudioError,
  assertBudget,
  audit,
  isUuid,
  loadWorkspace,
  requireProject,
  requireWorkspace,
  roleCan,
  studioRoute,
  type ProjectRow,
  type Workspace,
} from '../../lib/studio-access.js';
import { generateSpeech } from '../../lib/studio-tts.js';
import { isStudioHosted } from '../../lib/studio-storage.js';

const uid = (req: Request) => (req as unknown as { userId: string }).userId;
const AI_MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6';

async function askModel(system: string, user: string, maxTokens = 4000): Promise<string> {
  if (!hasProviderCredential()) throw new StudioError(503, 'AI_NOT_CONFIGURED', 'AI assist is not configured on this server.');
  const resp = await callAnthropicMessages({ model: AI_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { signal: AbortSignal.timeout(90_000) });
  if (!resp.ok) throw new StudioError(502, 'AI_FAILED', `AI request failed (${resp.status})`);
  const j = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
}

function extractJson<T>(text: string): T {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (m ? m[1] : text).trim();
  const start = raw.search(/[[{]/);
  return JSON.parse(raw.slice(start)) as T;
}

// ── Templates ───────────────────────────────────────────────────────────────

export const TemplateBodySchema = z.object({
  output: VoiceoverTimelineSchema.shape.output.optional(),
  audio: VoiceoverTimelineSchema.shape.audio.optional(),
  branding: VoiceoverTimelineSchema.shape.branding.optional(),
  presenter: VoiceoverTimelineSchema.shape.presenter.optional(),
  fonts: VoiceoverTimelineSchema.shape.fonts.optional(),
  pronunciations: VoiceoverTimelineSchema.shape.pronunciations.optional(),
  intro: CardSchema.nullable().optional(),
  outro: CardSchema.nullable().optional(),
  /** Narration on the outro card (start relative to the card), with its audio and presenter take:
   *  the series' shared closing clip, reused by every episode at no cost. */
  outro_blocks: z.array(VoiceBlockSchema).max(5).optional(),
  transition: z.object({ kind: z.string(), duration: z.number() }).nullable().optional(),
  overlay_style: z.record(z.unknown()).nullable().optional(),
  voice: z
    .object({ voice_id: z.string(), voice_name: z.string().optional(), voice_source: z.enum(['platform', 'user', 'workspace']), model_id: z.string(), settings: z.record(z.unknown()) })
    .nullable()
    .optional(),
});
export type TemplateBody = z.infer<typeof TemplateBodySchema>;

export function extractTemplate(tl: VoiceoverTimeline): TemplateBody {
  const first = tl.clips[0];
  const last = tl.clips[tl.clips.length - 1];
  const tr = tl.clips.find((c, i) => i > 0 && c.transition.kind !== 'none')?.transition ?? null;
  const o = tl.overlays[0];
  const b = tl.blocks.find((x) => x.voice_id);
  const hasOutro = tl.clips.length > 1 && last?.kind === 'card';
  const outroStart = hasOutro ? clipStarts(tl)[tl.clips.length - 1] : Infinity;
  const outroBlocks = tl.blocks
    .filter((x) => x.audio_url && x.start >= outroStart - 0.05)
    .map((x) => ({ ...x, start: Math.max(0, Math.round((x.start - outroStart) * 1000) / 1000), takes: [] }));
  return {
    output: tl.output,
    audio: tl.audio,
    branding: tl.branding,
    // The look travels with the series; consent is confirmed again in each project.
    presenter: { ...tl.presenter, consent: false },
    fonts: tl.fonts,
    pronunciations: tl.pronunciations,
    intro: first?.kind === 'card' ? first.card ?? null : null,
    outro: hasOutro ? last.card ?? null : null,
    outro_blocks: outroBlocks,
    transition: tr,
    overlay_style: o ? { size: o.size, color: o.color, box: o.box, box_color: o.box_color, animation: o.animation, font: o.font, y: o.y } : null,
    voice: b ? { voice_id: b.voice_id, voice_name: b.voice_name, voice_source: b.voice_source, model_id: b.model_id, settings: b.settings } : null,
  };
}

export function applyTemplateToTimeline(tl: VoiceoverTimeline, tpl: TemplateBody): VoiceoverTimeline {
  let clips = tl.clips.filter((c) => c.kind !== 'card');
  const tr = tpl.transition && tpl.transition.kind !== 'none' ? tpl.transition : null;
  if (tpl.intro) {
    clips = [{ id: `card_${randomUUID().slice(0, 8)}`, kind: 'card', card: tpl.intro, src_in: 0, src_out: 1, speed: 1, zoom: { mode: 'none', scale: 1.6, x: 0.5, y: 0.5, ease: 0.6 }, keyframes: [], fade_in: 0, fade_out: 0, transition: { kind: 'none', duration: 0.5 } }, ...clips];
    if (tr && clips[1]) clips[1] = { ...clips[1], transition: tr as never };
  }
  if (tpl.outro) {
    clips = [...clips, { id: `card_${randomUUID().slice(0, 8)}`, kind: 'card', card: tpl.outro, src_in: 0, src_out: 1, speed: 1, zoom: { mode: 'none', scale: 1.6, x: 0.5, y: 0.5, ease: 0.6 }, keyframes: [], fade_in: 0, fade_out: 0, transition: (tr ?? { kind: 'none', duration: 0.5 }) as never }];
  }
  // The intro occupies its own content plus any brand sting it plays first.
  const introLen = tpl.intro ? tpl.intro.duration + cardStingLength(tpl.intro) : 0;
  const introShift = tpl.intro && tl.clips[0]?.kind !== 'card' ? introLen - (tr ? Math.min(tr.duration, introLen / 2) : 0) : 0;
  const voice = tpl.voice;
  const blocks = tl.blocks.map((bk) => ({ ...bk, start: bk.start + introShift, ...(voice && !bk.voice_id ? { voice_id: voice.voice_id, voice_name: voice.voice_name, voice_source: voice.voice_source, model_id: voice.model_id, settings: voice.settings } : {}) }));
  // The series' closing narration (+ presenter take) lands on the new outro card, unless it already has some.
  if (tpl.outro && tpl.outro_blocks?.length) {
    const outroStart = clipStarts({ clips })[clips.length - 1];
    if (!blocks.some((bk) => bk.start >= outroStart - 0.05)) {
      blocks.push(...tpl.outro_blocks.map((bk) => ({ ...bk, id: `v_${randomUUID().slice(0, 8)}`, start: outroStart + bk.start })));
    }
  }
  return VoiceoverTimelineSchema.parse({
    ...tl,
    clips,
    blocks,
    overlays: tl.overlays.map((o) => ({ ...o, start: o.start + introShift, end: o.end + introShift })),
    effects: tl.effects.map((e) => ({ ...e, start: e.start + introShift, end: e.end + introShift })),
    output: tpl.output ?? tl.output,
    audio: tpl.audio ?? tl.audio,
    branding: tpl.branding ?? tl.branding,
    presenter: tpl.presenter ? { ...tpl.presenter, consent: tl.presenter.consent && tl.presenter.photo_url === tpl.presenter.photo_url } : tl.presenter,
    fonts: tpl.fonts ?? tl.fonts,
    pronunciations: tpl.pronunciations ?? tl.pronunciations,
  });
}

export async function loadTemplate(req: Request, id: string): Promise<{ id: string; name: string; template: TemplateBody; workspace_id: string | null }> {
  if (!isUuid(id)) throw new StudioError(404, 'NOT_FOUND', 'Template not found');
  const { data } = await supabase.from('voiceover_templates').select('id, user_id, workspace_id, name, template').eq('id', id).maybeSingle();
  if (!data) throw new StudioError(404, 'NOT_FOUND', 'Template not found');
  if (data.workspace_id) await requireWorkspace(req, data.workspace_id as string, 'view');
  else if (data.user_id !== uid(req)) throw new StudioError(404, 'NOT_FOUND', 'Template not found');
  return { id: data.id as string, name: data.name as string, workspace_id: (data.workspace_id as string | null) ?? null, template: TemplateBodySchema.parse(data.template) };
}

export const listTemplatesRoute = studioRoute(async (req, res) => {
  const { data: m } = await supabase.from('studio_workspace_members').select('workspace_id').eq('user_id', uid(req));
  const ws = (m ?? []).map((x) => x.workspace_id as string);
  const or = [`and(user_id.eq.${uid(req)},workspace_id.is.null)`, ...(ws.length ? [`workspace_id.in.(${ws.join(',')})`] : [])].join(',');
  const { data, error } = await supabase.from('voiceover_templates').select('id, name, description, workspace_id, user_id, created_at, template').or(or).order('created_at', { ascending: false });
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  res.json({ templates: (data ?? []).map((t) => ({ ...t, has_intro: Boolean((t.template as TemplateBody).intro), has_outro: Boolean((t.template as TemplateBody).outro) })) });
});

const SaveTemplateSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), project_id: z.string().uuid(), workspace_id: z.string().uuid().nullable().optional() });

export const saveTemplateRoute = studioRoute(async (req, res) => {
  const p = SaveTemplateSchema.parse(req.body);
  const { project } = await requireProject(req, p.project_id, 'edit');
  if (p.workspace_id) await requireWorkspace(req, p.workspace_id, 'edit');
  const template = extractTemplate(VoiceoverTimelineSchema.parse(project.timeline));
  const { data, error } = await supabase.from('voiceover_templates').insert({ user_id: uid(req), workspace_id: p.workspace_id ?? null, name: p.name, description: p.description ?? '', template }).select('id, name').single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: p.workspace_id, project_id: project.id, action: 'template.create', detail: { template_id: data.id, name: p.name } });
  res.status(201).json({ template: data });
});

export const deleteTemplateRoute = studioRoute(async (req, res) => {
  const tpl = await loadTemplate(req, String(req.params.id));
  if (tpl.workspace_id) await requireWorkspace(req, tpl.workspace_id, 'manage');
  await supabase.from('voiceover_templates').delete().eq('id', tpl.id);
  res.status(204).end();
});

export const applyTemplateRoute = studioRoute(async (req, res) => {
  const { project } = await requireProject(req, String(req.params.id), 'edit');
  const tpl = await loadTemplate(req, String(req.body?.template_id ?? ''));
  const timeline = applyTemplateToTimeline(VoiceoverTimelineSchema.parse(project.timeline), tpl.template);
  await supabase.from('voiceover_projects').update({ timeline, template_id: tpl.id, updated_at: new Date().toISOString() }).eq('id', project.id);
  res.json({ timeline });
});

// ── Assist: shorten to fit ──────────────────────────────────────────────────

const ShortenSchema = z.object({ text: z.string().trim().min(1).max(5000), target_seconds: z.number().positive().max(600), language: z.string().max(40).optional() });

export const shortenRoute = studioRoute(async (req, res) => {
  const p = ShortenSchema.parse(req.body);
  const targetChars = Math.max(20, Math.floor(p.target_seconds * 14 * 0.95));
  const out = await askModel(
    'You edit voice-over narration for screen-recorded tutorials. Rewrite the narration so it is spoken in the time available, keeping every key fact, product name and instruction, the same language, and the same tone. Keep any <break .../> tags. Reply with the rewritten narration only.',
    `Time available: ${p.target_seconds.toFixed(1)} seconds (≈${targetChars} characters at 150 words per minute).\n${p.language ? `Language: ${p.language}\n` : ''}\nNarration:\n${p.text}`,
    1500,
  );
  res.json({ text: out.replace(/^"|"$/g, '').trim(), target_chars: targetChars });
});

// ── Localize ────────────────────────────────────────────────────────────────

const LocalizeSchema = z.object({
  language: z.string().min(2).max(10),
  language_name: z.string().min(2).max(60),
  voice_id: z.string().max(64).optional(),
  voice_name: z.string().max(120).optional(),
  voice_source: z.enum(['platform', 'user', 'workspace']).optional(),
  model_id: z.string().max(64).optional(),
  translate_overlays: z.boolean().default(true),
  /** Extra glossary terms to keep untranslated (product names etc.). */
  keep: z.array(z.string().max(80)).max(100).default([]),
});

export const localizeRoute = studioRoute(async (req, res) => {
  const p = LocalizeSchema.parse(req.body);
  const { project, ws } = await requireProject(req, String(req.params.id), 'edit');
  const tl = VoiceoverTimelineSchema.parse(project.timeline);
  const items: string[] = [];
  const at: Array<(s: string) => void> = [];
  const next = structuredClone(tl);
  next.blocks.forEach((b) => { if (b.text.trim()) { items.push(b.text); at.push((s) => { b.text = s; }); } });
  if (p.translate_overlays) {
    next.overlays.forEach((o) => {
      items.push(o.text); at.push((s) => { o.text = s.slice(0, 300); });
      if (o.subtitle) { items.push(o.subtitle); at.push((s) => { o.subtitle = s.slice(0, 200); }); }
    });
    next.clips.forEach((c) => {
      if (c.kind === 'card' && c.card) {
        if (c.card.title) { items.push(c.card.title); at.push((s) => { c.card!.title = s.slice(0, 120); }); }
        if (c.card.subtitle) { items.push(c.card.subtitle); at.push((s) => { c.card!.subtitle = s.slice(0, 200); }); }
      }
    });
  }
  if (!items.length) throw new StudioError(400, 'NOTHING_TO_TRANSLATE', 'This project has no narration or text yet.');
  const glossary = [...new Set([...tl.pronunciations.map((r) => r.word), ...p.keep])];
  const raw = await askModel(
    'You localize voice-over scripts for software tutorials. Translate each string naturally for a native listener, keep the meaning and instructions exact, keep each string roughly the same spoken length (it must fit the same video timing), keep <break .../> tags, numbers, URLs and UI labels that appear on screen in their original form, and never translate glossary terms. Return ONLY a JSON array of strings, same order and length as the input.',
    `Target language: ${p.language_name} (${p.language})\nGlossary (keep exactly): ${JSON.stringify(glossary)}\n\nStrings:\n${JSON.stringify(items)}`,
    8000,
  );
  let translated: string[];
  try {
    translated = extractJson<string[]>(raw);
  } catch {
    throw new StudioError(502, 'AI_FAILED', 'Translation came back malformed. Try again.');
  }
  if (!Array.isArray(translated) || translated.length !== items.length) throw new StudioError(502, 'AI_FAILED', 'Translation was incomplete. Try again.');
  translated.forEach((s, i) => at[i](String(s)));
  next.blocks = next.blocks.map((b) =>
    VoiceBlockSchema.parse({
      ...b,
      audio_url: null, audio_duration: null, take_id: null, words: [], generated_text: null, audio_in: 0, audio_out: null, takes: [],
      ...(p.voice_id ? { voice_id: p.voice_id, voice_name: p.voice_name, voice_source: p.voice_source ?? b.voice_source } : {}),
      model_id: p.model_id ?? (/multilingual|v3|flash_v2_5|turbo_v2_5/.test(b.model_id) ? b.model_id : 'eleven_multilingual_v2'),
    }),
  );
  const { data, error } = await supabase
    .from('voiceover_projects')
    .insert({
      user_id: uid(req),
      workspace_id: project.workspace_id,
      title: `${project.title} · ${p.language_name}`.slice(0, 200),
      source: project.source,
      timeline: next,
      analysis: project.analysis,
      prepare_status: project.prepare_status,
      series: project.series,
      language: p.language,
      source_project_id: project.id,
      storage_region: project.storage_region,
    })
    .select('id, title, language')
    .single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: ws?.id, project_id: data.id as string, action: 'project.localize', detail: { from: project.id, language: p.language, strings: items.length } });
  res.status(201).json({ project: data });
});

// ── Review & comments ───────────────────────────────────────────────────────

const ReviewSchema = z.object({ action: z.enum(['submit', 'approve', 'request_changes', 'reopen']), note: z.string().max(2000).optional() });

export const reviewRoute = studioRoute(async (req, res) => {
  const p = ReviewSchema.parse(req.body);
  const { project, role, ws } = await requireProject(req, String(req.params.id), 'view');
  const need = p.action === 'submit' || p.action === 'reopen' ? 'edit' : 'approve';
  if (!roleCan(role, need)) throw new StudioError(403, 'FORBIDDEN', `Your role (${role}) can't ${p.action.replace('_', ' ')}.`);
  if (p.action === 'approve' && project.user_id === uid(req) && ws?.settings.require_approval && role !== 'owner') {
    throw new StudioError(403, 'FORBIDDEN', 'Someone other than the author has to approve this.');
  }
  const status = { submit: 'in_review', approve: 'approved', request_changes: 'changes_requested', reopen: 'draft' }[p.action];
  const patch: Record<string, unknown> = { review_status: status };
  if (p.action === 'approve') { patch.approved_by = uid(req); patch.approved_at = new Date().toISOString(); }
  else { patch.approved_by = null; patch.approved_at = null; }
  await supabase.from('voiceover_projects').update(patch).eq('id', project.id);
  if (p.note) {
    await supabase.from('voiceover_comments').insert({ project_id: project.id, user_id: uid(req), author_email: (req as unknown as { userEmail?: string }).userEmail ?? null, t: null, body: p.note, kind: p.action });
  }
  await audit(req, { workspace_id: project.workspace_id, project_id: project.id, action: `review.${p.action}`, detail: { note: p.note ?? null } });
  res.json({ review_status: status });
});

export const listCommentsRoute = studioRoute(async (req, res) => {
  const { project } = await requireProject(req, String(req.params.id), 'view');
  const { data } = await supabase.from('voiceover_comments').select('id, user_id, author_email, t, body, parent_id, resolved, kind, created_at').eq('project_id', project.id).order('created_at', { ascending: true });
  res.json({ comments: data ?? [] });
});

const CommentSchema = z.object({ t: z.number().min(0).nullable().optional(), body: z.string().trim().min(1).max(4000), parent_id: z.string().uuid().nullable().optional() });

export const createCommentRoute = studioRoute(async (req, res) => {
  const p = CommentSchema.parse(req.body);
  const { project } = await requireProject(req, String(req.params.id), 'comment');
  const { data, error } = await supabase
    .from('voiceover_comments')
    .insert({ project_id: project.id, user_id: uid(req), author_email: (req as unknown as { userEmail?: string }).userEmail ?? null, t: p.t ?? null, body: p.body, parent_id: p.parent_id ?? null, kind: 'comment' })
    .select('id, user_id, author_email, t, body, parent_id, resolved, kind, created_at')
    .single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  res.status(201).json({ comment: data });
});

async function loadComment(req: Request) {
  const id = String(req.params.comment_id);
  if (!isUuid(id)) throw new StudioError(404, 'NOT_FOUND', 'Comment not found');
  const { data } = await supabase.from('voiceover_comments').select('id, project_id, user_id').eq('id', id).maybeSingle();
  if (!data) throw new StudioError(404, 'NOT_FOUND', 'Comment not found');
  const access = await requireProject(req, data.project_id as string, 'comment');
  return { comment: data, ...access };
}

export const patchCommentRoute = studioRoute(async (req, res) => {
  const p = z.object({ resolved: z.boolean().optional(), body: z.string().trim().min(1).max(4000).optional() }).parse(req.body);
  const { comment, role } = await loadComment(req);
  if (p.body !== undefined && comment.user_id !== uid(req)) throw new StudioError(403, 'FORBIDDEN', 'Only the author can edit a comment.');
  const patch: Record<string, unknown> = {};
  if (p.body !== undefined) patch.body = p.body;
  if (p.resolved !== undefined) { if (!roleCan(role, 'comment')) throw new StudioError(403, 'FORBIDDEN', 'Not allowed'); patch.resolved = p.resolved; }
  await supabase.from('voiceover_comments').update(patch).eq('id', comment.id);
  res.json({ ok: true });
});

export const deleteCommentRoute = studioRoute(async (req, res) => {
  const { comment, role } = await loadComment(req);
  if (comment.user_id !== uid(req) && !roleCan(role, 'manage')) throw new StudioError(403, 'FORBIDDEN', 'Not allowed');
  await supabase.from('voiceover_comments').delete().eq('id', comment.id);
  res.status(204).end();
});

// ── Voice-clone consent ─────────────────────────────────────────────────────

const ConsentSchema = z.object({
  voice_id: z.string().min(1).max(64),
  voice_name: z.string().max(120).default(''),
  voice_source: z.enum(['user', 'workspace']),
  speaker_name: z.string().trim().min(2).max(120),
  statement: z.string().trim().min(20).max(2000),
  evidence_url: z.string().url().nullable().optional(),
  workspace_id: z.string().uuid().nullable().optional(),
});

export const listConsentsRoute = studioRoute(async (req, res) => {
  const ws = typeof req.query.workspace_id === 'string' && isUuid(req.query.workspace_id) ? req.query.workspace_id : null;
  if (ws) await requireWorkspace(req, ws, 'view');
  let q = supabase.from('voice_consents').select('id, workspace_id, voice_id, voice_name, voice_source, speaker_name, statement, evidence_url, attested_by, attested_by_email, attested_at, revoked_at').order('attested_at', { ascending: false });
  q = ws ? q.eq('workspace_id', ws) : q.is('workspace_id', null).eq('attested_by', uid(req));
  const { data } = await q;
  res.json({ consents: data ?? [] });
});

export const createConsentRoute = studioRoute(async (req, res) => {
  const p = ConsentSchema.parse(req.body);
  if (p.workspace_id) await requireWorkspace(req, p.workspace_id, 'manage');
  if (p.evidence_url && !isStudioHosted(p.evidence_url)) throw new StudioError(400, 'INVALID_INPUT', 'Upload evidence through Studio assets.');
  const { data, error } = await supabase
    .from('voice_consents')
    .insert({
      workspace_id: p.workspace_id ?? null,
      voice_id: p.voice_id,
      voice_name: p.voice_name,
      voice_source: p.voice_source,
      speaker_name: p.speaker_name,
      statement: p.statement,
      evidence_url: p.evidence_url ?? null,
      attested_by: uid(req),
      attested_by_email: (req as unknown as { userEmail?: string }).userEmail ?? null,
      attested_ip: req.ip ?? null,
    })
    .select('id')
    .single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: p.workspace_id, action: 'consent.record', detail: { consent_id: data.id, voice_id: p.voice_id, speaker: p.speaker_name } });
  res.status(201).json({ consent: data });
});

export const revokeConsentRoute = studioRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw new StudioError(404, 'NOT_FOUND', 'Consent not found');
  const { data } = await supabase.from('voice_consents').select('id, workspace_id, attested_by, voice_id').eq('id', id).maybeSingle();
  if (!data) throw new StudioError(404, 'NOT_FOUND', 'Consent not found');
  if (data.workspace_id) await requireWorkspace(req, data.workspace_id as string, 'manage');
  else if (data.attested_by !== uid(req)) throw new StudioError(404, 'NOT_FOUND', 'Consent not found');
  await supabase.from('voice_consents').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  await audit(req, { workspace_id: data.workspace_id as string | null, action: 'consent.revoke', detail: { consent_id: id, voice_id: data.voice_id } });
  res.status(204).end();
});

// ── Automate ────────────────────────────────────────────────────────────────

export const AutomateSchema = z.object({
  source_url: z.string().url(),
  title: z.string().trim().max(200).optional(),
  script: z.string().trim().min(1).max(50_000),
  workspace_id: z.string().uuid().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  series: z.string().max(120).nullable().optional(),
  voice_id: z.string().min(1).max(64),
  voice_name: z.string().max(120).optional(),
  voice_source: z.enum(['platform', 'user', 'workspace']).default('platform'),
  model_id: z.string().max(64).default('eleven_multilingual_v2'),
  settings: StudioTtsRequestSchema.shape.settings.optional(),
  language_code: z.string().min(2).max(5).optional(),
  aspects: z.array(z.enum(['source', '16:9', '9:16', '1:1'])).min(1).max(4).default(['source']),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
  captions: z.enum(['off', 'minimal', 'tiktok', 'hormozi']).default('minimal'),
  apply: z.array(z.enum(['cut', 'speed', 'focus', 'click'])).default(['cut', 'speed', 'focus', 'click']),
  /** Optional — the prepare step measures the recording; give them to skip a placeholder. */
  duration: z.number().positive().max(6 * 3600).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  webhook_url: z.string().url().nullable().optional(),
  notify_email: z.string().email().nullable().optional(),
});
type AutomateConfig = z.infer<typeof AutomateSchema>;

export const automateRoute = studioRoute(async (req, res) => {
  const p = AutomateSchema.parse(req.body);
  const { createProjectFromSource, startStudioWorkflow, assertBalance, chargesUser } = await import('./studio.js');
  const cues = parseNarrationScript(p.script);
  if (!cues.length) throw new StudioError(400, 'INVALID_INPUT', 'The script is empty.');
  // Up-front estimate so a run doesn't die half-way for lack of credits.
  const chars = cues.reduce((s, c) => s + c.text.length, 0);
  const estimate = chargesUser(req)
    ? (p.voice_source === 'platform' ? quoteVoiceoverTtsCredits(chars) : 0) + quoteVoiceoverRenderCredits(p.duration ?? chars / 14 + 10, { quality: p.quality, formats: p.aspects.length })
    : 0;
  const ws = p.workspace_id ? (await requireWorkspace(req, p.workspace_id, 'render')).ws : null;
  await assertBudget(ws, uid(req), estimate);
  await assertBalance(uid(req), estimate);

  const project = await createProjectFromSource(req, {
    title: p.title,
    source_url: p.source_url,
    duration: p.duration ?? 1,
    width: p.width ?? 1920,
    height: p.height ?? 1080,
    workspace_id: p.workspace_id ?? null,
    template_id: p.template_id ?? null,
    series: p.series ?? null,
    language: p.language_code ?? null,
    automation: { ...p, notify_email: p.notify_email ?? (req as unknown as { userEmail?: string }).userEmail ?? null, status: 'running' },
  });
  const runId = randomUUID();
  await supabase.from('primitive_runs').insert({
    id: runId,
    user_id: uid(req),
    primitive_id: 'voiceover_render',
    status: 'submitted',
    input: { project_id: project.id, automated: true, title: project.title, description: project.title, provenance: { workspace_id: ws?.id ?? null } },
  });
  try {
    await startStudioWorkflow('voiceoverAutomateWorkflow', `voiceover_automate-${runId}`, [
      { primitive_run_id: runId, project_id: project.id, user_id: uid(req), source_url: (project.source as { url: string }).url, storage_region: project.storage_region ?? null },
    ]);
  } catch (err) {
    await supabase.from('primitive_runs').update({ status: 'failed', error_code: 'DISPATCH_FAILED', error_message: (err as Error).message }).eq('id', runId);
    throw new StudioError(502, 'DISPATCH_FAILED', 'Could not start the automation. Try again.');
  }
  await supabase.from('voiceover_projects').update({ last_render_run_id: runId }).eq('id', project.id);
  await audit(req, { workspace_id: ws?.id, project_id: project.id, action: 'automate.start', detail: { run_id: runId, blocks: cues.length, aspects: p.aspects } });
  res.status(202).json({ project_id: project.id, run_id: runId, status_url: `/v1/studio/renders/${runId}`, estimated_credits: estimate });
});

/** Worker → api-v2: generate voices + assemble the timeline for an automated project. */
export async function automateStepRoute(req: Request, res: Response): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.header('x-internal-secret') !== secret) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
  try {
    const { project_id, user_id } = z.object({ project_id: z.string().uuid(), user_id: z.string().uuid(), primitive_run_id: z.string().uuid() }).parse(req.body);
    const { data: row } = await supabase.from('voiceover_projects').select('*').eq('id', project_id).maybeSingle();
    if (!row || row.user_id !== user_id) throw new StudioError(404, 'NOT_FOUND', 'Project not found');
    const project = row as ProjectRow;
    const cfg = AutomateSchema.parse(project.automation);
    const ws: Workspace | null = project.workspace_id ? await loadWorkspace(project.workspace_id) : null;
    const { data: au } = await supabase.auth.admin.getUserById(user_id);
    const charge = isBillingEnabled() && !isAdminEmail(au?.user?.email ?? null);

    // 1. Rebuild the source clip from the measured recording (keep template cards).
    let tl = VoiceoverTimelineSchema.parse(project.timeline);
    const dur = Number((project.source as { duration?: number }).duration ?? 0);
    const cards = { intro: tl.clips[0]?.kind === 'card' ? tl.clips[0] : null, outro: tl.clips.length > 1 && tl.clips[tl.clips.length - 1].kind === 'card' ? tl.clips[tl.clips.length - 1] : null };
    const firstSource = tl.clips.find((c) => c.kind !== 'card');
    tl = { ...tl, clips: [...(cards.intro ? [cards.intro] : []), { ...(firstSource ?? tl.clips[0]), kind: 'source', src_in: 0, src_out: dur, keyframes: [] }, ...(cards.outro ? [cards.outro] : [])] };

    // 2. Smart edits from the analysis.
    const suggestions = ((project.analysis as { suggestions?: EditSuggestionLike[] } | null)?.suggestions ?? []) as EditSuggestionLike[];
    tl = applySuggestions(tl, suggestions, cfg.apply);

    // 3. Narration: timed cues at their times, the rest back-to-back after the intro.
    const introEnd = cards.intro ? clipStarts(tl)[1] ?? 0 : 0;
    let cursor = introEnd + 0.4;
    const cues = parseNarrationScript(cfg.script);
    const blocks = cues.map((c) => {
      const b = VoiceBlockSchema.parse({
        id: `v_${randomUUID().slice(0, 8)}`,
        start: c.start ?? cursor,
        text: c.text,
        voice_id: cfg.voice_id,
        voice_name: cfg.voice_name,
        voice_source: cfg.voice_source,
        model_id: cfg.model_id,
        settings: cfg.settings ?? {},
      });
      cursor = b.start + blockPlayLength(b) + 0.35;
      return b;
    });

    // 4. Generate every block (continuity via neighbour text), then re-space with real lengths.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const r = await generateSpeech({
        userId: user_id,
        project: { ...project, timeline: tl },
        ws,
        chargeCredits: charge,
        req: StudioTtsRequestSchema.parse({
          project_id, block_id: b.id, text: b.text, voice_id: b.voice_id, voice_source: b.voice_source, model_id: b.model_id, settings: b.settings,
          previous_text: blocks[i - 1]?.text.slice(-1000), next_text: blocks[i + 1]?.text.slice(0, 1000), language_code: cfg.language_code,
        }),
      });
      blocks[i] = { ...b, audio_url: r.audio_url, audio_duration: r.audio_duration, words: r.words, take_id: r.take_id, generated_text: b.text, generated_voice_id: b.voice_id };
    }
    tl = autoSpaceTimelineBlocks({ ...tl, blocks });

    // 5. Output settings.
    tl = {
      ...tl,
      output: {
        ...tl.output,
        aspect: cfg.aspects[0],
        extra_aspects: cfg.aspects.slice(1),
        quality: cfg.quality,
        captions: { ...tl.output.captions, enabled: cfg.captions !== 'off', style: cfg.captions === 'off' ? tl.output.captions.style : cfg.captions },
      },
    };
    const lastVoiceEnd = Math.max(0, ...tl.blocks.map((b) => b.start + blockPlayLength(b)));
    const warnings = lastVoiceEnd > timelineDuration(tl) + 0.2 ? [`Narration runs ${(lastVoiceEnd - timelineDuration(tl)).toFixed(1)}s past the end of the video; the end is cut.`] : [];
    await supabase.from('voiceover_projects').update({ timeline: tl, automation: { ...cfg, status: 'rendering', warnings }, updated_at: new Date().toISOString() }).eq('id', project_id);

    const { buildRenderInput } = await import('./studio.js');
    const input = await buildRenderInput({ ...project, timeline: tl }, ws, { webhook_url: cfg.webhook_url ?? null, notify_email: cfg.notify_email ?? null });
    res.json({ render_input: input });
  } catch (err) {
    if (err instanceof StudioError) { res.status(err.status).json({ error: { code: err.code, message: err.message } }); return; }
    if (err instanceof z.ZodError) { res.status(400).json({ error: { code: 'INVALID_INPUT', message: err.issues[0]?.message } }); return; }
    console.error('[studio/automate-step]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: (err as Error).message } });
  }
}
