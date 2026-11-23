// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — edit a silent screen recording and voice it with
 * ElevenLabs text-to-speech.
 *
 *   GET    /v1/studio/projects                  list my projects
 *   POST   /v1/studio/projects                  create from an uploaded recording
 *   GET    /v1/studio/projects/:id              load (source + timeline)
 *   PATCH  /v1/studio/projects/:id              autosave title / timeline
 *   DELETE /v1/studio/projects/:id
 *   GET    /v1/studio/voices                    platform + my-key voices and models
 *   GET    /v1/studio/provider-key              my ElevenLabs key status (last4 only)
 *   PUT    /v1/studio/provider-key              save my ElevenLabs key (verified first)
 *   DELETE /v1/studio/provider-key
 *   POST   /v1/studio/tts                       generate one voice block (sync, ~2-10s)
 *   POST   /v1/studio/projects/:id/quote        render price
 *   POST   /v1/studio/projects/:id/render       start the ffmpeg render (Temporal)
 *   GET    /v1/studio/renders/:run_id           render status + progress + video
 *
 * Billing: TTS on the platform key is debited per generation (credits keyed
 * on voiceover_tts_takes.id, refunded on provider failure). TTS on the user's
 * own key is free. Renders are debited by the worker (primitive 'voiceover_render').
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
  timelineDuration,
  validateVoiceoverForRender,
} from '@vantly-ugc/schema';
import { supabase } from '../../server.js';
import { getTemporalClient } from '../../orchestrator/temporal/client.js';
import { getTemporalConfig } from '../../orchestrator/temporal/config.js';
import { withTimeout } from '../../orchestrator/temporal/timeout.js';
import { isBillingEnabled } from './skills.js';
import { isAdminEmail } from '../../lib/admin-allowlist.js';
import { getR2PublicUrlPrefix, uploadUserAudioBuffer, uploadUserVideoFromUrl } from '../../lib/r2-upload.js';
import {
  ElevenLabsHttpError,
  listElevenLabsModels,
  listElevenLabsVoicesWithKey,
  platformElevenLabsKey,
  synthesizeElevenLabsWithTimestamps,
  verifyElevenLabsKey,
  type ElevenLabsModel,
  type ElevenLabsVoice,
} from '../../lib/elevenlabs.js';
import {
  deleteUserProviderKey,
  getUserProviderKey,
  getUserProviderKeyMeta,
  providerKeysConfigured,
  saveUserProviderKey,
} from '../../lib/provider-keys.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userIdOf(req: Request, res: Response): string | null {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    return null;
  }
  return userId;
}

function bad(res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: { code, message, ...(extra ?? {}) } });
}

function chargesUser(req: Request): boolean {
  return isBillingEnabled() && !isAdminEmail((req as any).userEmail as string | undefined);
}

function primitiveTaskQueue(): string {
  return process.env.TEMPORAL_PRIMITIVE_TASK_QUEUE?.trim() || 'primitive-vnext-v1';
}

async function loadProject(userId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await supabase
    .from('voiceover_projects')
    .select('id, title, source, timeline, last_render_run_id, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`voiceover_projects lookup failed: ${error.message}`);
  return data;
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function listStudioProjectsRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const { data, error } = await supabase
    .from('voiceover_projects')
    .select('id, title, source, last_render_run_id, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return bad(res, 500, 'DATABASE_ERROR', error.message);
  res.json({ projects: data ?? [] });
}

const CreateProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Public URL of the uploaded recording (Supabase Storage or R2). Re-hosted to R2. */
  source_url: z.string().url(),
  duration: z.number().positive().max(4 * 3600),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  has_audio: z.boolean().optional(),
});

export async function createStudioProjectRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, 'INVALID_INPUT', 'Invalid project', { detail: parsed.error.flatten() });
  const p = parsed.data;

  let hosted: { url: string };
  try {
    hosted = await uploadUserVideoFromUrl(userId, p.source_url);
  } catch (err) {
    return bad(res, 400, 'SOURCE_UPLOAD_FAILED', (err as Error).message);
  }

  const source = VoiceoverSourceSchema.parse({
    url: hosted.url,
    duration: p.duration,
    width: p.width,
    height: p.height,
    has_audio: p.has_audio ?? false,
  });
  // Starts as one clip spanning the whole recording.
  const timeline = VoiceoverTimelineSchema.parse({
    clips: [{ id: 'c_' + randomUUID().slice(0, 8), src_in: 0, src_out: p.duration }],
  });

  const { data, error } = await supabase
    .from('voiceover_projects')
    .insert({ user_id: userId, title: p.title ?? 'Untitled voiceover', source, timeline })
    .select('id, title, source, timeline, last_render_run_id, created_at, updated_at')
    .single();
  if (error) return bad(res, 500, 'DATABASE_ERROR', error.message);
  res.status(201).json({ project: data });
}

export async function getStudioProjectRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const project = await loadProject(userId, String(req.params.id));
  if (!project) return bad(res, 404, 'NOT_FOUND', 'Project not found');
  res.json({ project });
}

const PatchProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  timeline: VoiceoverTimelineSchema.optional(),
});

export async function patchStudioProjectRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const parsed = PatchProjectSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, 'INVALID_INPUT', 'Invalid project update', { detail: parsed.error.flatten() });
  const project = await loadProject(userId, String(req.params.id));
  if (!project) return bad(res, 404, 'NOT_FOUND', 'Project not found');

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title) patch.title = parsed.data.title;
  if (parsed.data.timeline) {
    // Audio must be ours: a block may only reference R2-hosted takes.
    const prefix = getR2PublicUrlPrefix();
    const foreign = parsed.data.timeline.blocks.find((b) => b.audio_url && !b.audio_url.startsWith(prefix));
    if (foreign) return bad(res, 400, 'INVALID_INPUT', 'voice block audio must come from /v1/studio/tts');
    patch.timeline = parsed.data.timeline;
  }
  const { data, error } = await supabase
    .from('voiceover_projects')
    .update(patch)
    .eq('id', project.id)
    .eq('user_id', userId)
    .select('id, title, updated_at')
    .single();
  if (error) return bad(res, 500, 'DATABASE_ERROR', error.message);
  res.json({ project: data });
}

export async function deleteStudioProjectRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const project = await loadProject(userId, String(req.params.id));
  if (!project) return bad(res, 404, 'NOT_FOUND', 'Project not found');
  const { error } = await supabase.from('voiceover_projects').delete().eq('id', project.id).eq('user_id', userId);
  if (error) return bad(res, 500, 'DATABASE_ERROR', error.message);
  res.status(204).end();
}

// ── Voices & provider key ───────────────────────────────────────────────────

let platformCache: { at: number; voices: ElevenLabsVoice[]; models: ElevenLabsModel[] } | null = null;
const PLATFORM_CACHE_MS = 5 * 60_000;

async function platformCatalog(): Promise<{ voices: ElevenLabsVoice[]; models: ElevenLabsModel[] } | null> {
  const key = platformElevenLabsKey();
  if (!key) return null;
  if (platformCache && Date.now() - platformCache.at < PLATFORM_CACHE_MS) return platformCache;
  const [voices, models] = await Promise.all([listElevenLabsVoicesWithKey(key), listElevenLabsModels(key)]);
  platformCache = { at: Date.now(), voices, models };
  return platformCache;
}

export async function listStudioVoicesRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;

  const out: Record<string, unknown> = {};
  try {
    const cat = await platformCatalog();
    out.platform = cat ? { configured: true, voices: cat.voices } : { configured: false, voices: [] };
    out.models = cat?.models ?? [];
  } catch (err) {
    console.error(`[studio/voices] platform list failed: ${(err as Error).message}`);
    out.platform = { configured: true, voices: [], error: 'Could not reach ElevenLabs.' };
    out.models = [];
  }

  try {
    const mine = await getUserProviderKey(userId, 'elevenlabs');
    if (!mine) {
      out.user = { configured: false, voices: [], byo_supported: providerKeysConfigured() };
    } else {
      const [voices, models] = await Promise.all([
        listElevenLabsVoicesWithKey(mine.key),
        (out.models as ElevenLabsModel[]).length ? Promise.resolve(null) : listElevenLabsModels(mine.key),
      ]);
      // Users usually want their own (cloned / professional) voices first.
      const rank = (v: ElevenLabsVoice) => (v.category === 'cloned' || v.category === 'professional' ? 0 : 1);
      out.user = { configured: true, last4: mine.last4, voices: voices.sort((a, b) => rank(a) - rank(b)) };
      if (models) out.models = models;
    }
  } catch (err) {
    const status = err instanceof ElevenLabsHttpError ? err.status : 0;
    out.user = {
      configured: true,
      voices: [],
      error: status === 401 ? 'Your ElevenLabs key was rejected — update it in Studio settings.' : 'Could not reach ElevenLabs with your key.',
    };
  }

  res.json({
    ...out,
    pricing: { tts_credits_per_1k_chars: quoteVoiceoverTtsCredits(1000), charges: chargesUser(req) },
  });
}

export async function getStudioProviderKeyRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const meta = await getUserProviderKeyMeta(userId, 'elevenlabs');
  res.json({ supported: providerKeysConfigured(), elevenlabs: meta ? { configured: true, ...meta } : { configured: false } });
}

const PutKeySchema = z.object({ api_key: z.string().trim().min(20).max(200) });

export async function putStudioProviderKeyRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  if (!providerKeysConfigured()) return bad(res, 503, 'NOT_CONFIGURED', 'Personal API keys are not enabled on this server.');
  const parsed = PutKeySchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, 'INVALID_INPUT', 'Paste a valid ElevenLabs API key.');
  if (!(await verifyElevenLabsKey(parsed.data.api_key))) {
    return bad(res, 400, 'KEY_REJECTED', 'ElevenLabs rejected this key. Check it has Voices + Text to Speech access.');
  }
  const { last4 } = await saveUserProviderKey(userId, 'elevenlabs', parsed.data.api_key);
  res.json({ elevenlabs: { configured: true, last4 } });
}

export async function deleteStudioProviderKeyRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  await deleteUserProviderKey(userId, 'elevenlabs');
  res.status(204).end();
}

// ── Text to speech ──────────────────────────────────────────────────────────

export async function studioTtsRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const parsed = StudioTtsRequestSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, 'INVALID_INPUT', 'Invalid TTS request', { detail: parsed.error.flatten() });
  const t = parsed.data;

  const project = await loadProject(userId, t.project_id);
  if (!project) return bad(res, 404, 'NOT_FOUND', 'Project not found');

  let key: string | null;
  if (t.voice_source === 'user') {
    const mine = await getUserProviderKey(userId, 'elevenlabs');
    if (!mine) return bad(res, 400, 'NO_USER_KEY', 'Add your ElevenLabs API key in Studio settings to use your own voices.');
    key = mine.key;
  } else {
    key = platformElevenLabsKey();
    if (!key) return bad(res, 503, 'NOT_CONFIGURED', 'Voiceover is not set up on this server. Add your own ElevenLabs key instead.');
  }

  const takeId = randomUUID();
  const chars = t.text.length;
  const credits = t.voice_source === 'platform' && chargesUser(req) ? quoteVoiceoverTtsCredits(chars) : 0;

  const { error: insErr } = await supabase.from('voiceover_tts_takes').insert({
    id: takeId,
    user_id: userId,
    project_id: project.id,
    block_id: t.block_id,
    key_source: t.voice_source,
    voice_id: t.voice_id,
    model_id: t.model_id,
    chars,
    credits_deducted: credits,
    status: 'submitted',
  });
  if (insErr) return bad(res, 500, 'DATABASE_ERROR', insErr.message);

  if (credits > 0) {
    const { error: creditErr } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: credits,
      p_job_id: takeId,
      p_description: `Voiceover TTS · ${chars} chars`,
    });
    if (creditErr) {
      await supabase.from('voiceover_tts_takes').update({ status: 'failed', credits_deducted: 0, error_message: creditErr.message }).eq('id', takeId);
      const insufficient = /INSUFFICIENT|balance|USER_NOT_FOUND/i.test(creditErr.message ?? '');
      return bad(
        res,
        insufficient ? 402 : 500,
        insufficient ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED',
        insufficient ? `This needs ${credits} credits.` : 'Credit deduction failed',
      );
    }
  }

  const fail = async (status: number, code: string, message: string) => {
    if (credits > 0) await supabase.rpc('refund_credits', { p_job_id: takeId });
    await supabase.from('voiceover_tts_takes').update({ status: 'failed', error_message: message.slice(0, 500) }).eq('id', takeId);
    bad(res, status, code, message);
  };

  let speech;
  try {
    speech = await synthesizeElevenLabsWithTimestamps(key, {
      voiceId: t.voice_id,
      text: t.text,
      modelId: t.model_id,
      settings: t.settings,
      // eleven_v3 ignores/limits continuity hints; only send them to v2-family models.
      previousText: t.model_id.includes('v3') ? undefined : t.previous_text,
      nextText: t.model_id.includes('v3') ? undefined : t.next_text,
      languageCode: t.language_code,
    });
  } catch (err) {
    const status = err instanceof ElevenLabsHttpError ? err.status : 0;
    if (status === 401 && t.voice_source === 'user') return fail(400, 'KEY_REJECTED', 'ElevenLabs rejected your API key.');
    if (status === 400 || status === 422) return fail(400, 'TTS_REJECTED', (err as Error).message);
    if (status === 429) return fail(429, 'TTS_RATE_LIMITED', 'ElevenLabs is rate-limiting this account. Try again in a moment.');
    console.error(`[studio/tts] ${takeId} failed: ${(err as Error).message}`);
    return fail(502, 'TTS_FAILED', 'ElevenLabs could not generate this block. Try again.');
  }

  let uploaded;
  try {
    uploaded = await uploadUserAudioBuffer(userId, speech.audio);
  } catch (err) {
    return fail(500, 'STORAGE_FAILED', (err as Error).message);
  }

  await supabase
    .from('voiceover_tts_takes')
    .update({ status: 'succeeded', audio_url: uploaded.url, audio_duration: speech.duration })
    .eq('id', takeId);

  res.json({
    take_id: takeId,
    audio_url: uploaded.url,
    audio_duration: speech.duration,
    words: speech.words,
    credits_deducted: credits,
    voice_source: t.voice_source,
  });
}

// ── Render ──────────────────────────────────────────────────────────────────

async function buildRenderInput(userId: string, id: string) {
  const project = await loadProject(userId, id);
  if (!project) return { error: [404, 'NOT_FOUND', 'Project not found'] as const };
  const parsed = VoiceoverRenderInputSchema.safeParse({
    project_id: project.id,
    source: project.source,
    timeline: project.timeline,
  });
  if (!parsed.success) return { error: [400, 'INVALID_PROJECT', parsed.error.issues[0]?.message ?? 'Invalid project'] as const };
  const problems = validateVoiceoverForRender(parsed.data);
  if (problems.length) return { error: [400, 'NOT_READY', problems.join('; ')] as const };
  const prefix = getR2PublicUrlPrefix();
  if (!parsed.data.source.url.startsWith(prefix)) return { error: [400, 'INVALID_PROJECT', 'source is not hosted'] as const };
  return { project, input: parsed.data };
}

export async function quoteStudioRenderRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const r = await buildRenderInput(userId, String(req.params.id));
  if ('error' in r && r.error) return bad(res, r.error[0], r.error[1], r.error[2]);
  const seconds = timelineDuration(r.input!.timeline);
  res.json({ output_seconds: seconds, credits: chargesUser(req) ? quoteVoiceoverRenderCredits(seconds) : 0 });
}

export async function startStudioRenderRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const r = await buildRenderInput(userId, String(req.params.id));
  if ('error' in r && r.error) return bad(res, r.error[0], r.error[1], r.error[2]);
  const { project, input } = r as { project: NonNullable<Awaited<ReturnType<typeof loadProject>>>; input: z.infer<typeof VoiceoverRenderInputSchema> };

  const seconds = timelineDuration(input.timeline);
  const credits = chargesUser(req) ? quoteVoiceoverRenderCredits(seconds) : 0;

  // Balance preflight so the user gets a 402 now rather than a failed render later.
  if (credits > 0) {
    const { data: bal } = await supabase
      .from('user_credits')
      .select('monthly_credits_remaining, purchased_balance')
      .eq('user_id', userId)
      .maybeSingle();
    const total = Number(bal?.monthly_credits_remaining ?? 0) + Number(bal?.purchased_balance ?? 0);
    if (bal && total < credits) {
      return bad(res, 402, 'INSUFFICIENT_CREDITS', `This render needs ${credits} credits; you have ${total}.`);
    }
  }

  const runId = randomUUID();
  const { error: insErr } = await supabase.from('primitive_runs').insert({
    id: runId,
    user_id: userId,
    primitive_id: 'voiceover_render',
    status: 'submitted',
    input: { ...input, title: project.title, duration: Math.round(seconds), description: project.title },
  });
  if (insErr) return bad(res, 500, 'DATABASE_ERROR', insErr.message);

  let cfg: ReturnType<typeof getTemporalConfig>;
  try {
    cfg = getTemporalConfig();
    const client = await getTemporalClient();
    await withTimeout(
      client.workflow.start('voiceoverRenderWorkflow', {
        workflowId: `voiceover_render-${runId}`,
        taskQueue: primitiveTaskQueue(),
        workflowExecutionTimeout: Math.max(cfg.workflowExecutionTimeoutMs, 60 * 60_000),
        args: [{ primitive_run_id: runId, user_id: userId, input }],
      }),
      cfg.startTimeoutMs,
      'temporal.workflow.start.voiceover_render',
    );
  } catch (err) {
    await supabase
      .from('primitive_runs')
      .update({ status: 'failed', error_code: 'DISPATCH_FAILED', error_message: (err as Error).message, finished_at: new Date().toISOString() })
      .eq('id', runId);
    return bad(res, 502, 'DISPATCH_FAILED', 'Could not start the render. Try again.');
  }

  await supabase.from('voiceover_projects').update({ last_render_run_id: runId }).eq('id', project.id);
  res.status(202).json({ run_id: runId, status: 'submitted', credits });
}

export async function getStudioRenderRoute(req: Request, res: Response): Promise<void> {
  const userId = userIdOf(req, res);
  if (!userId) return;
  const runId = String(req.params.run_id ?? '');
  if (!UUID_RE.test(runId)) return bad(res, 400, 'INVALID_INPUT', 'invalid run id');
  const { data: run, error } = await supabase
    .from('primitive_runs')
    .select('id, status, error_code, error_message, credits_deducted, created_at, finished_at, primitive_artifacts(url, kind, bytes)')
    .eq('id', runId)
    .eq('user_id', userId)
    .eq('primitive_id', 'voiceover_render')
    .maybeSingle();
  if (error) return bad(res, 500, 'DATABASE_ERROR', error.message);
  if (!run) return bad(res, 404, 'NOT_FOUND', 'Render not found');

  const { data: ev } = await supabase
    .from('primitive_events')
    .select('message')
    .eq('primitive_run_id', runId)
    .eq('code', 'progress')
    .order('ts', { ascending: false })
    .limit(1);
  const progress = (ev?.[0]?.message as { stage?: string; pct?: number } | undefined) ?? null;
  const art = (run.primitive_artifacts as Array<{ url: string; kind: string; bytes: number | null }> | null)?.[0];

  res.json({
    run_id: run.id,
    status: run.status,
    progress,
    video_url: art?.url ?? null,
    bytes: art?.bytes ?? null,
    credits_deducted: run.credits_deducted ?? 0,
    error: run.status === 'failed' ? { code: run.error_code, message: run.error_message } : null,
  });
}
