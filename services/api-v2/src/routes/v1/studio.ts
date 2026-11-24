// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — core routes. Edit a screen recording and voice it with
 * ElevenLabs text-to-speech. (Templates, localization, automation, review and
 * consent live in studio-pro.ts; workspaces/governance in studio-workspaces.ts.)
 *
 *   GET    /v1/studio/projects                    my + my workspaces' projects (?workspace_id, ?series)
 *   POST   /v1/studio/projects                    create from an uploaded recording (+ template)
 *   GET    /v1/studio/projects/:id
 *   PATCH  /v1/studio/projects/:id                title / timeline / series / workspace
 *   DELETE /v1/studio/projects/:id
 *   POST   /v1/studio/uploads                     start a direct-to-storage multipart upload
 *   POST   /v1/studio/uploads/complete            finish it
 *   POST   /v1/studio/uploads/abort
 *   POST   /v1/studio/assets                      re-host music / logo / font / consent evidence
 *   GET    /v1/studio/voices                      platform + my key + workspace key voices, models
 *   GET|PUT|DELETE /v1/studio/provider-key        my ElevenLabs key
 *   POST   /v1/studio/tts                         generate one voice block
 *   POST   /v1/studio/projects/:id/quote
 *   POST   /v1/studio/projects/:id/render
 *   POST   /v1/studio/projects/:id/prepare        (re)run proxy + filmstrip + analysis
 *   GET    /v1/studio/renders/:run_id
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  StudioTtsRequestSchema,
  VoiceoverRenderInputSchema,
  VoiceoverSourceSchema,
  VoiceoverTimelineSchema,
  quoteVoiceoverRenderCredits,
  quoteVoiceoverTtsCredits,
  renderAspects,
  timelineDuration,
  validateVoiceoverForRender,
  type VoiceoverTimeline,
} from '@vantly-ugc/schema';
import { supabase } from '../../server.js';
import { getTemporalClient } from '../../orchestrator/temporal/client.js';
import { getTemporalConfig } from '../../orchestrator/temporal/config.js';
import { withTimeout } from '../../orchestrator/temporal/timeout.js';
import { isBillingEnabled } from './skills.js';
import { isAdminEmail } from '../../lib/admin-allowlist.js';
import { safeFetchToBuffer, uploadUserVideoFromUrl } from '../../lib/r2-upload.js';
import {
  ElevenLabsHttpError,
  listElevenLabsModels,
  listElevenLabsVoicesWithKey,
  platformElevenLabsKey,
  verifyElevenLabsKey,
  type ElevenLabsModel,
  type ElevenLabsVoice,
} from '../../lib/elevenlabs.js';
import {
  deleteUserProviderKey,
  getUserProviderKey,
  getUserProviderKeyMeta,
  getWorkspaceProviderKey,
  providerKeysConfigured,
  saveUserProviderKey,
} from '../../lib/provider-keys.js';
import {
  MAX_UPLOAD_BYTES,
  abortMultipart,
  completeMultipart,
  isStudioHosted,
  putStudioObject,
  regionOfUrl,
  startMultipart,
} from '../../lib/studio-storage.js';
import {
  PROJECT_COLUMNS,
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
import { applyTemplateToTimeline, loadTemplate } from './studio-pro.js';

const uid = (req: Request) => (req as unknown as { userId: string }).userId;

export function chargesUser(req: Request): boolean {
  return isBillingEnabled() && !isAdminEmail((req as unknown as { userEmail?: string }).userEmail);
}

export function primitiveTaskQueue(): string {
  return process.env.TEMPORAL_PRIMITIVE_TASK_QUEUE?.trim() || 'primitive-vnext-v1';
}

export async function startStudioWorkflow(type: string, workflowId: string, args: unknown[]): Promise<void> {
  const cfg = getTemporalConfig();
  const client = await getTemporalClient();
  await withTimeout(
    client.workflow.start(type, {
      workflowId,
      taskQueue: primitiveTaskQueue(),
      workflowExecutionTimeout: Math.max(cfg.workflowExecutionTimeoutMs, 3 * 60 * 60_000),
      args,
    }),
    cfg.startTimeoutMs,
    `temporal.workflow.start.${type}`,
  );
}

/** Kick off proxy + filmstrip + smart-edit analysis. Best effort: the editor works without it. */
export async function startPrepare(project: { id: string; user_id: string; source: { url: string } | null; storage_region?: string | null }): Promise<void> {
  if (!project.source?.url) return;
  try {
    await startStudioWorkflow('voiceoverPrepareWorkflow', `voiceover_prepare-${project.id}-${Date.now()}`, [
      { project_id: project.id, user_id: project.user_id, source_url: project.source.url, storage_region: project.storage_region ?? null },
    ]);
    await supabase.from('voiceover_projects').update({ prepare_status: 'running' }).eq('id', project.id);
  } catch (err) {
    console.warn(`[studio] prepare dispatch failed for ${project.id}: ${(err as Error).message}`);
    await supabase.from('voiceover_projects').update({ prepare_status: 'failed' }).eq('id', project.id);
  }
}

// ── Projects ────────────────────────────────────────────────────────────────

export const listStudioProjectsRoute = studioRoute(async (req, res) => {
  const userId = uid(req);
  const { data: memberships } = await supabase.from('studio_workspace_members').select('workspace_id, role').eq('user_id', userId);
  const wsIds = (memberships ?? []).map((m) => m.workspace_id as string);
  const wsFilter = typeof req.query.workspace_id === 'string' && isUuid(req.query.workspace_id) ? req.query.workspace_id : null;
  let q = supabase
    .from('voiceover_projects')
    .select('id, user_id, workspace_id, title, source, review_status, language, series, source_project_id, prepare_status, last_render_run_id, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (wsFilter) {
    if (!wsIds.includes(wsFilter)) throw new StudioError(404, 'NOT_FOUND', 'Workspace not found');
    q = q.eq('workspace_id', wsFilter);
  } else {
    q = q.eq('user_id', userId).is('workspace_id', null);
  }
  if (typeof req.query.series === 'string' && req.query.series) q = q.eq('series', req.query.series);
  const { data, error } = await q;
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  res.json({ projects: data ?? [] });
});

const CreateProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  source_url: z.string().url(),
  duration: z.number().positive().max(6 * 3600),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  has_audio: z.boolean().optional(),
  workspace_id: z.string().uuid().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  series: z.string().trim().max(120).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
});

export async function createProjectFromSource(
  req: Request,
  p: z.infer<typeof CreateProjectSchema> & { automation?: unknown },
): Promise<ProjectRow> {
  const userId = uid(req);
  let ws: Workspace | null = null;
  if (p.workspace_id) ws = (await requireWorkspace(req, p.workspace_id, 'edit')).ws;
  const region = ws?.settings.data_region ?? 'default';

  // Direct multipart uploads already live in our storage; anything else is fetched + re-hosted.
  let sourceUrl = p.source_url;
  if (!isStudioHosted(sourceUrl)) {
    try {
      sourceUrl = (await uploadUserVideoFromUrl(userId, p.source_url)).url;
    } catch (err) {
      throw new StudioError(400, 'SOURCE_UPLOAD_FAILED', (err as Error).message);
    }
  }
  const source = VoiceoverSourceSchema.parse({ url: sourceUrl, duration: p.duration, width: p.width, height: p.height, has_audio: p.has_audio ?? false });
  let timeline: VoiceoverTimeline = VoiceoverTimelineSchema.parse({ clips: [{ id: 'c_' + randomUUID().slice(0, 8), src_in: 0, src_out: p.duration }] });
  if (ws?.settings.disclosure_badge) timeline = { ...timeline, branding: { ...timeline.branding, disclosure_badge: true } };
  if (p.template_id) {
    const tpl = await loadTemplate(req, p.template_id);
    timeline = applyTemplateToTimeline(timeline, tpl.template);
  }

  const { data, error } = await supabase
    .from('voiceover_projects')
    .insert({
      user_id: userId,
      workspace_id: ws?.id ?? null,
      title: p.title ?? 'Untitled voiceover',
      source,
      timeline,
      series: p.series ?? null,
      language: p.language ?? null,
      template_id: p.template_id ?? null,
      storage_region: regionOfUrl(sourceUrl)?.key ?? region,
      automation: p.automation ?? null,
      prepare_status: 'pending',
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: ws?.id, project_id: data.id as string, action: 'project.create', detail: { title: data.title } });
  return data as ProjectRow;
}

export const createStudioProjectRoute = studioRoute(async (req, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid project', { detail: parsed.error.flatten() });
  const project = await createProjectFromSource(req, parsed.data);
  await startPrepare(project as never);
  res.status(201).json({ project });
});

export const getStudioProjectRoute = studioRoute(async (req, res) => {
  const { project, role, ws } = await requireProject(req, String(req.params.id), 'view');
  res.json({
    project,
    role,
    workspace: ws ? { id: ws.id, name: ws.name, settings: { require_approval: ws.settings.require_approval, require_voice_consent: ws.settings.require_voice_consent } } : null,
  });
});

const PatchProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  timeline: VoiceoverTimelineSchema.optional(),
  series: z.string().trim().max(120).nullable().optional(),
  workspace_id: z.string().uuid().nullable().optional(),
});

export const patchStudioProjectRoute = studioRoute(async (req, res) => {
  const parsed = PatchProjectSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid project update', { detail: parsed.error.flatten() });
  const { project, ws } = await requireProject(req, String(req.params.id), 'edit');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title) patch.title = parsed.data.title;
  if (parsed.data.series !== undefined) patch.series = parsed.data.series;
  if (parsed.data.timeline) {
    const tl = parsed.data.timeline;
    const media = [
      ...tl.blocks.flatMap((b) => [b.audio_url, ...b.takes.map((k) => k.audio_url)]),
      tl.audio.music?.url,
      tl.branding.logo_url,
      ...tl.fonts.map((f) => f.url),
    ].filter((u): u is string => Boolean(u));
    if (media.some((u) => !isStudioHosted(u))) throw new StudioError(400, 'INVALID_INPUT', 'media must be uploaded through Studio');
    patch.timeline = tl;
    // Changing an approved edit sends it back for review.
    if (project.review_status === 'approved' && JSON.stringify(tl) !== JSON.stringify(project.timeline)) {
      patch.review_status = 'in_review';
      patch.approved_by = null;
      patch.approved_at = null;
      await audit(req, { workspace_id: project.workspace_id, project_id: project.id, action: 'review.reopened', detail: { reason: 'edited after approval' } });
    }
  }
  if (parsed.data.workspace_id !== undefined && parsed.data.workspace_id !== project.workspace_id) {
    if (project.user_id !== uid(req)) throw new StudioError(403, 'FORBIDDEN', 'Only the project creator can move it.');
    if (parsed.data.workspace_id) await requireWorkspace(req, parsed.data.workspace_id, 'edit');
    patch.workspace_id = parsed.data.workspace_id;
    await audit(req, { workspace_id: parsed.data.workspace_id ?? ws?.id, project_id: project.id, action: 'project.move', detail: { from: project.workspace_id, to: parsed.data.workspace_id } });
  }
  const { data, error } = await supabase.from('voiceover_projects').update(patch).eq('id', project.id).select('id, title, updated_at, review_status').single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  res.json({ project: data });
});

export const deleteStudioProjectRoute = studioRoute(async (req, res) => {
  const { project, role } = await requireProject(req, String(req.params.id), 'view');
  // Creators can delete their own projects; anyone else needs owner/admin rights.
  const allowed = project.user_id === uid(req) ? roleCan(role, 'edit') : roleCan(role, 'delete');
  if (!allowed) throw new StudioError(403, 'FORBIDDEN', `Your role (${role}) can't delete this project.`);
  const { error } = await supabase.from('voiceover_projects').delete().eq('id', project.id);
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: project.workspace_id, project_id: project.id, action: 'project.delete', detail: { title: project.title } });
  res.status(204).end();
});

export const prepareStudioProjectRoute = studioRoute(async (req, res) => {
  const { project } = await requireProject(req, String(req.params.id), 'edit');
  await startPrepare(project as never);
  res.status(202).json({ prepare_status: 'running' });
});

// ── Uploads + assets ────────────────────────────────────────────────────────

const StartUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().regex(/^(video\/(mp4|quicktime|webm|x-m4v)|audio\/(mpeg|mp3|wav|x-wav|mp4|x-m4a|webm)|image\/(png|jpeg)|font\/(ttf|otf)|application\/(octet-stream|x-font-ttf|x-font-otf|font-sfnt))$/),
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  workspace_id: z.string().uuid().nullable().optional(),
});
export const startStudioUploadRoute = studioRoute(async (req, res) => {
  const parsed = StartUploadSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Recordings: MP4, MOV or WebM up to 5 GB. Assets: MP3/WAV/M4A, PNG/JPEG, TTF/OTF.');
  if (!parsed.data.content_type.startsWith('video/') && parsed.data.bytes > 60 * 1024 * 1024) throw new StudioError(400, 'INVALID_INPUT', 'Assets can be up to 60 MB.');
  let region = 'default';
  if (parsed.data.workspace_id) region = (await requireWorkspace(req, parsed.data.workspace_id, 'edit')).ws.settings.data_region;
  const up = await startMultipart(region, uid(req), parsed.data.filename, parsed.data.content_type, parsed.data.bytes);
  await supabase.from('voiceover_uploads').insert({ id: randomUUID(), user_id: uid(req), region: up.region, key: up.key, upload_id: up.upload_id, bytes: parsed.data.bytes });
  res.json(up);
});

const CompleteUploadSchema = z.object({
  key: z.string().min(1).max(400),
  upload_id: z.string().min(1).max(400),
  parts: z.array(z.object({ part_number: z.number().int().positive(), etag: z.string().min(1).max(200) })).min(1).max(10_000),
});

async function ownUpload(req: Request, key: string, uploadId: string) {
  const { data } = await supabase.from('voiceover_uploads').select('id, region').eq('user_id', uid(req)).eq('key', key).eq('upload_id', uploadId).maybeSingle();
  if (!data) throw new StudioError(404, 'NOT_FOUND', 'Upload not found');
  return data as { id: string; region: string };
}

export const completeStudioUploadRoute = studioRoute(async (req, res) => {
  const parsed = CompleteUploadSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid completion');
  const up = await ownUpload(req, parsed.data.key, parsed.data.upload_id);
  const { url } = await completeMultipart(up.region, parsed.data.key, parsed.data.upload_id, parsed.data.parts);
  await supabase.from('voiceover_uploads').update({ completed_at: new Date().toISOString() }).eq('id', up.id);
  res.json({ url });
});

export const abortStudioUploadRoute = studioRoute(async (req, res) => {
  const parsed = CompleteUploadSchema.pick({ key: true, upload_id: true }).safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid abort');
  const up = await ownUpload(req, parsed.data.key, parsed.data.upload_id);
  await abortMultipart(up.region, parsed.data.key, parsed.data.upload_id);
  res.status(204).end();
});

const AssetSchema = z.object({
  kind: z.enum(['music', 'logo', 'font', 'evidence']),
  /** Public URL of the uploaded file (Supabase Storage upload, brand kit logo, …). */
  url: z.string().url(),
  project_id: z.string().uuid().optional(),
  name: z.string().max(200).optional(),
});

const ASSET_RULES = {
  music: { max: 60 * 1024 * 1024, ok: (b: Buffer) => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || b.toString('ascii', 0, 4) === 'RIFF' || b.toString('ascii', 4, 8) === 'ftyp', ext: 'mp3', mime: 'audio/mpeg' },
  logo: { max: 10 * 1024 * 1024, ok: (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8), ext: 'png', mime: 'image/png' },
  font: { max: 20 * 1024 * 1024, ok: (b: Buffer) => ['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'ttcf'].includes(b.toString('latin1', 0, 4)), ext: 'ttf', mime: 'font/ttf' },
  evidence: { max: 60 * 1024 * 1024, ok: (_b: Buffer) => true, ext: 'bin', mime: 'application/octet-stream' },
} as const;

export const createStudioAssetRoute = studioRoute(async (req, res) => {
  const parsed = AssetSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid asset');
  let region = 'default';
  if (parsed.data.project_id) region = (await requireProject(req, parsed.data.project_id, 'edit')).project.storage_region ?? 'default';
  const rule = ASSET_RULES[parsed.data.kind];
  const { buffer, contentType } = await safeFetchToBuffer(parsed.data.url, rule.max, 60_000).catch((e: Error) => { throw new StudioError(400, 'ASSET_FETCH_FAILED', e.message); });
  if (!rule.ok(buffer)) throw new StudioError(400, 'ASSET_INVALID', `That file doesn't look like a valid ${parsed.data.kind}.`);
  // Already uploaded straight to our storage and valid → keep it where it is.
  if (isStudioHosted(parsed.data.url)) { res.json({ url: parsed.data.url, name: parsed.data.name ?? '' }); return; }
  const isJpeg = parsed.data.kind === 'logo' && buffer[0] === 0xff;
  const isMp4 = parsed.data.kind === 'music' && buffer.toString('ascii', 4, 8) === 'ftyp';
  const isWav = parsed.data.kind === 'music' && buffer.toString('ascii', 0, 4) === 'RIFF';
  const isOtf = parsed.data.kind === 'font' && buffer.toString('latin1', 0, 4) === 'OTTO';
  const ext = isJpeg ? 'jpg' : isMp4 ? 'm4a' : isWav ? 'wav' : isOtf ? 'otf' : parsed.data.kind === 'evidence' ? (contentType.split('/')[1]?.split(';')[0] || 'bin') : rule.ext;
  const mime = isJpeg ? 'image/jpeg' : isMp4 ? 'audio/mp4' : isWav ? 'audio/wav' : isOtf ? 'font/otf' : parsed.data.kind === 'evidence' ? contentType : rule.mime;
  const out = await putStudioObject(region, `studio/assets/${uid(req)}/${parsed.data.kind}/${randomUUID()}.${ext}`, buffer, mime);
  res.json({ url: out.url, name: parsed.data.name ?? '' });
});

// ── Voices & personal key ───────────────────────────────────────────────────

let platformCache: { at: number; voices: ElevenLabsVoice[]; models: ElevenLabsModel[] } | null = null;
async function platformCatalog(): Promise<{ voices: ElevenLabsVoice[]; models: ElevenLabsModel[] } | null> {
  const key = platformElevenLabsKey();
  if (!key) return null;
  if (platformCache && Date.now() - platformCache.at < 5 * 60_000) return platformCache;
  const [voices, models] = await Promise.all([listElevenLabsVoicesWithKey(key), listElevenLabsModels(key)]);
  platformCache = { at: Date.now(), voices, models };
  return platformCache;
}

const rankClones = (v: ElevenLabsVoice) => (v.category === 'cloned' || v.category === 'professional' ? 0 : 1);

async function keyVoices(key: string | undefined | null, last4?: string) {
  if (!key) return { configured: false, voices: [] as ElevenLabsVoice[] };
  try {
    const voices = await listElevenLabsVoicesWithKey(key);
    return { configured: true, last4, voices: voices.sort((a, b) => rankClones(a) - rankClones(b)) };
  } catch (err) {
    const status = err instanceof ElevenLabsHttpError ? err.status : 0;
    return { configured: true, last4, voices: [], error: status === 401 ? 'This ElevenLabs key was rejected.' : 'Could not reach ElevenLabs with this key.' };
  }
}

export const listStudioVoicesRoute = studioRoute(async (req, res) => {
  const userId = uid(req);
  const out: Record<string, unknown> = {};
  try {
    const cat = await platformCatalog();
    out.platform = cat ? { configured: true, voices: cat.voices } : { configured: false, voices: [] };
    out.models = cat?.models ?? [];
  } catch {
    out.platform = { configured: true, voices: [], error: 'Could not reach ElevenLabs.' };
    out.models = [];
  }
  const mine = await getUserProviderKey(userId, 'elevenlabs');
  out.user = { ...(await keyVoices(mine?.key, mine?.last4)), byo_supported: providerKeysConfigured() };
  const wsId = typeof req.query.workspace_id === 'string' && isUuid(req.query.workspace_id) ? req.query.workspace_id : null;
  if (wsId) {
    const { ws } = await requireWorkspace(req, wsId, 'view');
    const wk = await getWorkspaceProviderKey(ws.id, 'elevenlabs');
    out.workspace = { ...(await keyVoices(wk?.key, wk?.last4)), name: ws.name };
    if (!(out.models as unknown[]).length && wk) out.models = await listElevenLabsModels(wk.key).catch(() => []);
  }
  if (!(out.models as unknown[]).length && mine) out.models = await listElevenLabsModels(mine.key).catch(() => []);
  const { data: consents } = await supabase.from('voice_consents').select('voice_id').is('revoked_at', null).or(`attested_by.eq.${userId}${wsId ? `,workspace_id.eq.${wsId}` : ''}`);
  out.consented_voice_ids = [...new Set((consents ?? []).map((c) => c.voice_id as string))];
  res.json({ ...out, pricing: { tts_credits_per_1k_chars: quoteVoiceoverTtsCredits(1000), charges: chargesUser(req) } });
});

export const getStudioProviderKeyRoute = studioRoute(async (req, res) => {
  const meta = await getUserProviderKeyMeta(uid(req), 'elevenlabs');
  res.json({ supported: providerKeysConfigured(), elevenlabs: meta ? { configured: true, ...meta } : { configured: false } });
});

const PutKeySchema = z.object({ api_key: z.string().trim().min(20).max(200) });

export const putStudioProviderKeyRoute = studioRoute(async (req, res) => {
  if (!providerKeysConfigured()) throw new StudioError(503, 'NOT_CONFIGURED', 'Personal API keys are not enabled on this server.');
  const parsed = PutKeySchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Paste a valid ElevenLabs API key.');
  if (!(await verifyElevenLabsKey(parsed.data.api_key))) throw new StudioError(400, 'KEY_REJECTED', 'ElevenLabs rejected this key. Check it has Voices + Text to Speech access.');
  const { last4 } = await saveUserProviderKey(uid(req), 'elevenlabs', parsed.data.api_key);
  await audit(req, { action: 'provider_key.save', detail: { scope: 'user', last4 } });
  res.json({ elevenlabs: { configured: true, last4 } });
});

export const deleteStudioProviderKeyRoute = studioRoute(async (req, res) => {
  await deleteUserProviderKey(uid(req), 'elevenlabs');
  await audit(req, { action: 'provider_key.delete', detail: { scope: 'user' } });
  res.status(204).end();
});

// ── Text to speech ──────────────────────────────────────────────────────────

export const studioTtsRoute = studioRoute(async (req, res) => {
  const parsed = StudioTtsRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new StudioError(400, 'INVALID_INPUT', 'Invalid TTS request', { detail: parsed.error.flatten() });
  const { project, ws } = await requireProject(req, parsed.data.project_id, 'edit');
  const result = await generateSpeech({ userId: uid(req), project, ws, req: parsed.data, chargeCredits: chargesUser(req) });
  res.json(result);
});

// ── Render ──────────────────────────────────────────────────────────────────

export async function buildRenderInput(project: ProjectRow, ws: Workspace | null, extra?: { webhook_url?: string | null; notify_email?: string | null }) {
  const tl = project.timeline as VoiceoverTimeline;
  const voices = new Map<string, { voice_id: string; name?: string; source: string; consent_id: string | null }>();
  for (const b of tl?.blocks ?? []) if (b.audio_url && b.voice_id) voices.set(`${b.voice_source}:${b.voice_id}`, { voice_id: b.voice_id, name: b.voice_name, source: b.voice_source, consent_id: null });
  if (voices.size) {
    const { data: consents } = await supabase.from('voice_consents').select('id, voice_id').in('voice_id', [...voices.values()].map((v) => v.voice_id)).is('revoked_at', null);
    for (const v of voices.values()) v.consent_id = (consents ?? []).find((c) => c.voice_id === v.voice_id)?.id ?? null;
  }
  const parsed = VoiceoverRenderInputSchema.safeParse({
    project_id: project.id,
    source: project.source,
    timeline: project.timeline,
    storage_region: project.storage_region ?? null,
    provenance: { title: project.title, voices: [...voices.values()], workspace_id: ws?.id ?? null, approved_by: project.approved_by ?? null },
    webhook_url: extra?.webhook_url ?? ws?.settings.webhook_url ?? null,
    notify_email: extra?.notify_email ?? null,
  });
  if (!parsed.success) throw new StudioError(400, 'INVALID_PROJECT', parsed.error.issues[0]?.message ?? 'Invalid project');
  const problems = validateVoiceoverForRender(parsed.data);
  if (problems.length) throw new StudioError(400, 'NOT_READY', problems.join('; '));
  if (!isStudioHosted(parsed.data.source.url)) throw new StudioError(400, 'INVALID_PROJECT', 'source is not hosted');
  if (project.source?.purged_at) throw new StudioError(410, 'SOURCE_PURGED', 'The source recording was deleted by your retention policy.');
  return parsed.data;
}

function renderCredits(req: Request, input: z.infer<typeof VoiceoverRenderInputSchema>): number {
  const seconds = timelineDuration(input.timeline);
  return chargesUser(req) ? quoteVoiceoverRenderCredits(seconds, { quality: input.timeline.output.quality, formats: renderAspects(input.timeline.output).length }) : 0;
}

export const quoteStudioRenderRoute = studioRoute(async (req, res) => {
  const { project, ws } = await requireProject(req, String(req.params.id), 'view');
  const input = await buildRenderInput(project, ws);
  res.json({ output_seconds: timelineDuration(input.timeline), credits: renderCredits(req, input), formats: renderAspects(input.timeline.output) });
});

export async function assertBalance(userId: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  const { data: bal } = await supabase.from('user_credits').select('monthly_credits_remaining, purchased_balance').eq('user_id', userId).maybeSingle();
  const total = Number(bal?.monthly_credits_remaining ?? 0) + Number(bal?.purchased_balance ?? 0);
  if (bal && total < credits) throw new StudioError(402, 'INSUFFICIENT_CREDITS', `This render needs ${credits} credits; you have ${total}.`);
}

const RenderBodySchema = z.object({ notify_email: z.string().email().nullable().optional(), webhook_url: z.string().url().nullable().optional() }).default({});

export const startStudioRenderRoute = studioRoute(async (req, res) => {
  const body = RenderBodySchema.parse(req.body ?? {});
  const { project, ws } = await requireProject(req, String(req.params.id), 'render');
  const input = await buildRenderInput(project, ws, { notify_email: body.notify_email ?? (req as unknown as { userEmail?: string }).userEmail ?? null, webhook_url: body.webhook_url });
  if (ws?.settings.require_approval && project.review_status !== 'approved' && input.timeline.output.quality !== 'draft') {
    throw new StudioError(403, 'APPROVAL_REQUIRED', `${ws.name} requires approval before a final render. Render a draft, or submit for review.`);
  }
  const credits = renderCredits(req, input);
  await assertBudget(ws, uid(req), credits);
  await assertBalance(uid(req), credits);

  const runId = randomUUID();
  const { error: insErr } = await supabase.from('primitive_runs').insert({
    id: runId,
    user_id: uid(req),
    primitive_id: 'voiceover_render',
    status: 'submitted',
    input: { ...input, title: project.title, duration: Math.round(timelineDuration(input.timeline)), description: project.title },
  });
  if (insErr) throw new StudioError(500, 'DATABASE_ERROR', insErr.message);
  try {
    await startStudioWorkflow('voiceoverRenderWorkflow', `voiceover_render-${runId}`, [{ primitive_run_id: runId, user_id: uid(req), input }]);
  } catch (err) {
    await supabase.from('primitive_runs').update({ status: 'failed', error_code: 'DISPATCH_FAILED', error_message: (err as Error).message, finished_at: new Date().toISOString() }).eq('id', runId);
    throw new StudioError(502, 'DISPATCH_FAILED', 'Could not start the render. Try again.');
  }
  await supabase.from('voiceover_projects').update({ last_render_run_id: runId }).eq('id', project.id);
  await audit(req, { workspace_id: ws?.id, project_id: project.id, action: 'render.start', detail: { run_id: runId, credits, quality: input.timeline.output.quality, formats: renderAspects(input.timeline.output) } });
  res.status(202).json({ run_id: runId, status: 'submitted', credits });
});

export const getStudioRenderRoute = studioRoute(async (req, res) => {
  const runId = String(req.params.run_id ?? '');
  if (!isUuid(runId)) throw new StudioError(400, 'INVALID_INPUT', 'invalid run id');
  const { data: run, error } = await supabase
    .from('primitive_runs')
    .select('id, user_id, status, error_code, error_message, credits_deducted, created_at, finished_at, input, primitive_artifacts(url, kind, bytes, metadata)')
    .eq('id', runId)
    .eq('primitive_id', 'voiceover_render')
    .maybeSingle();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  if (!run) throw new StudioError(404, 'NOT_FOUND', 'Render not found');
  if (run.user_id !== uid(req)) {
    const pid = (run.input as { project_id?: string } | null)?.project_id;
    if (!pid) throw new StudioError(404, 'NOT_FOUND', 'Render not found');
    await requireProject(req, pid, 'view');
  }
  const { data: ev } = await supabase.from('primitive_events').select('message').eq('primitive_run_id', runId).eq('code', 'progress').order('ts', { ascending: false }).limit(1);
  const arts = (run.primitive_artifacts as Array<{ url: string; kind: string; bytes: number | null; metadata: Record<string, unknown> | null }> | null) ?? [];
  const videos = arts.filter((a) => a.kind === 'voiceover_video').map((a) => ({ aspect: (a.metadata?.aspect as string) ?? 'source', url: a.url, bytes: a.bytes, width: a.metadata?.width, height: a.metadata?.height }));
  res.json({
    run_id: run.id,
    status: run.status,
    progress: (ev?.[0]?.message as { stage?: string; pct?: number } | undefined) ?? null,
    video_url: videos[0]?.url ?? null,
    videos,
    manifest_url: arts.find((a) => a.kind === 'provenance_manifest')?.url ?? null,
    c2pa_url: arts.find((a) => a.kind === 'voiceover_video_c2pa')?.url ?? null,
    credits_deducted: run.credits_deducted ?? 0,
    error: run.status === 'failed' ? { code: run.error_code, message: run.error_message } : null,
  });
});

export { loadWorkspace };
