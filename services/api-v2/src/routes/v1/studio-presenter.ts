// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — presenter takes: the user, from their own photo, lip-synced
 * to a voice block and shown in a corner circle by the render.
 *
 *   POST /v1/studio/projects/:id/presenter   start takes for blocks (already-made clips are reused, not re-bought,
 *                                            unless `remake` asks for a fresh take)
 *   GET  /v1/studio/presenter/:run_id        status + clip of one take
 *
 * The editor writes the returned run_id onto the block, polls, and fills
 * block.presenter.clip_url / clip_key when the take finishes, so a take is only
 * ever paid for once per voice take + photo (presenterTakeKey).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  VoiceoverTimelineSchema,
  blockAudioLength,
  presenterBlockProblem,
  presenterFrame,
  presenterTakeKey,
  quotePresenterCredits,
  type VoiceoverPresenterTakeInput,
} from '@vantly-ugc/schema';
import { supabase } from '../../server.js';
import { isStudioHosted } from '../../lib/studio-storage.js';
import { StudioError, assertBudget, audit, isUuid, requireProject, studioRoute } from '../../lib/studio-access.js';
import { assertBalance, chargesUser, startStudioWorkflow } from './studio.js';

const uid = (req: unknown) => (req as { userId: string }).userId;

const StartBodySchema = z.object({
  block_ids: z.array(z.string().min(1).max(64)).min(1).max(40),
  /** Make a fresh take even when this block already has one (e.g. the last take came out wrong). */
  remake: z.boolean().default(false),
});

export const startPresenterRoute = studioRoute(async (req, res) => {
  const body = StartBodySchema.safeParse(req.body);
  if (!body.success) throw new StudioError(400, 'INVALID_INPUT', 'Pick at least one voice block', { detail: body.error.flatten() });
  const { project, ws } = await requireProject(req, String(req.params.id), 'edit');
  const tl = VoiceoverTimelineSchema.parse(project.timeline ?? {});
  const look = tl.presenter;
  if (!look.photo_url) throw new StudioError(400, 'NO_PHOTO', 'Add your photo in Style → Presenter first.');
  if (!look.consent) throw new StudioError(400, 'CONSENT_REQUIRED', 'Confirm the presenter consent in Style → Presenter first.');
  if ([look.photo_url, look.style_url].some((u) => u && !isStudioHosted(u))) throw new StudioError(400, 'INVALID_INPUT', 'Presenter photos must be uploaded through Studio');

  const todo: Array<{ block_id: string; input: VoiceoverPresenterTakeInput; credits: number }> = [];
  const cached: Array<{ block_id: string; clip_url: string; clip_key: string }> = [];
  for (const blockId of new Set(body.data.block_ids)) {
    const b = tl.blocks.find((x) => x.id === blockId);
    if (!b) throw new StudioError(404, 'BLOCK_NOT_FOUND', 'That voice block is gone — save and try again.');
    const problem = presenterBlockProblem(b, look);
    if (problem) throw new StudioError(400, 'NOT_READY', problem, { block_id: b.id });
    if (!isStudioHosted(b.audio_url!)) throw new StudioError(400, 'INVALID_INPUT', 'voice audio is not hosted');
    const frame = presenterFrame(tl, b);
    const key = presenterTakeKey(b, look, frame)!;
    if (!body.data.remake && b.presenter?.clip_url && b.presenter.clip_key === key) {
      cached.push({ block_id: b.id, clip_url: b.presenter.clip_url, clip_key: key });
      continue;
    }
    const len = blockAudioLength(b);
    todo.push({
      block_id: b.id,
      credits: chargesUser(req) ? quotePresenterCredits(len) : 0,
      input: {
        project_id: project.id,
        block_id: b.id,
        photo_url: look.photo_url,
        style_url: look.style_url,
        scene: look.scene,
        audio_url: b.audio_url!,
        audio_in: b.audio_in,
        audio_length: len,
        clip_key: key,
        frame,
        storage_region: project.storage_region ?? null,
        workspace_id: ws?.id ?? null,
      },
    });
  }

  const credits = todo.reduce((s, t) => s + t.credits, 0);
  await assertBudget(ws, uid(req), credits);
  await assertBalance(uid(req), credits);

  const takes: Array<{ block_id: string; run_id: string; clip_key: string; credits: number }> = [];
  for (const t of todo) {
    const runId = randomUUID();
    const { error: insErr } = await supabase.from('primitive_runs').insert({
      id: runId,
      user_id: uid(req),
      primitive_id: 'voiceover_presenter',
      status: 'submitted',
      input: t.input,
    });
    if (insErr) throw new StudioError(500, 'DATABASE_ERROR', insErr.message);
    try {
      await startStudioWorkflow('voiceoverPresenterWorkflow', `voiceover_presenter-${runId}`, [{ primitive_run_id: runId, user_id: uid(req), input: t.input }]);
    } catch (err) {
      await supabase.from('primitive_runs').update({ status: 'failed', error_code: 'DISPATCH_FAILED', error_message: (err as Error).message, finished_at: new Date().toISOString() }).eq('id', runId);
      throw new StudioError(502, 'DISPATCH_FAILED', 'Could not start the presenter take. Try again.');
    }
    takes.push({ block_id: t.block_id, run_id: runId, clip_key: t.input.clip_key, credits: t.credits });
  }
  if (takes.length) {
    await audit(req, { workspace_id: ws?.id, project_id: project.id, action: 'presenter.start', detail: { runs: takes.map((t) => t.run_id), credits } });
  }
  res.status(202).json({ takes, cached, credits });
});

export const getPresenterRoute = studioRoute(async (req, res) => {
  const runId = String(req.params.run_id ?? '');
  if (!isUuid(runId)) throw new StudioError(400, 'INVALID_INPUT', 'invalid run id');
  const { data: run, error } = await supabase
    .from('primitive_runs')
    .select('id, user_id, status, error_code, error_message, input, primitive_artifacts(url, kind)')
    .eq('id', runId)
    .eq('primitive_id', 'voiceover_presenter')
    .maybeSingle();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  if (!run) throw new StudioError(404, 'NOT_FOUND', 'Presenter take not found');
  const input = (run.input ?? {}) as Partial<VoiceoverPresenterTakeInput>;
  if (run.user_id !== uid(req)) {
    if (!input.project_id) throw new StudioError(404, 'NOT_FOUND', 'Presenter take not found');
    await requireProject(req, input.project_id, 'view');
  }
  const clip = ((run.primitive_artifacts as Array<{ url: string; kind: string }> | null) ?? []).find((a) => a.kind === 'voiceover_presenter');
  res.json({
    run_id: run.id,
    status: run.status,
    block_id: input.block_id ?? null,
    clip_key: input.clip_key ?? null,
    clip_url: run.status === 'succeeded' ? clip?.url ?? null : null,
    error: run.status === 'failed' ? { code: run.error_code, message: run.error_message } : null,
  });
});
