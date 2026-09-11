// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v2/generate/:kind  (image | video | audio) — the loose surface.
 * POST /v2/quote/:kind     — the same validation + pricing, no job/spend.
 *
 * This is the agent-facing counterpart to the fixed skills (make_ugc,
 * selfie, crazy look, podcast, storybook, ...): three primitives that say
 * what they are and nothing more — a prompt, an optional model id from
 * the catalog (@vantly-ugc/schema/v2 V2_MODELS), optional references or
 * frames. The agent picks the model; we validate the pick against the
 * live catalog and price it from the SAME table the MCP tools and the
 * worker read, so a quote, a bill and a tool description can never say
 * three different things.
 *
 *   1. Auth (bearer token via authMiddleware on the parent router)
 *   2. Parse + validate with @vantly-ugc/schema/v2 (quoteAny), which also
 *      resolves model: "auto" server-side so the price quoted is the
 *      price of the model that actually runs
 *   3. (quote only stops here)
 *   4. Create generation_jobs row (operation='generate_<kind>')
 *   5. Deduct credits via deduct_credits RPC
 *   6. Dispatch to media-worker-v2 POST /v2/generate/:kind (HTTP)
 *   7. Return 201 + job_id + credits_deducted
 *
 * Mirrors selfie.ts's shape closely on purpose — same job-row / credit /
 * dispatch-failure-refund conventions, same webhook contract, so nothing
 * else in the system (reconciler, webhook-provider, the Jobs/Gallery
 * pages, the agent-chat polling) needs a special case for these routes.
 *
 * NOTE: only the HTTP dispatch engine is wired here. This repo also has
 * an optional Temporal engine for selfie/crazy-look (ORCHESTRATOR_ENGINE
 * env var); the loose surface does not have a Temporal workflow yet, so
 * if that engine is selected this route returns a clear 503 rather than
 * silently dropping the job. See dispatchGenerateToHttpWorker's comment.
 */

import type { Request, Response } from 'express';
import {
  quoteAny,
  deriveVideoMode,
  type GenerateKind,
  type ModelStatsMap,
} from '@vantly-ugc/schema/v2';
import { supabase } from '../../server.js';
import { getOrchestratorEngine } from '../../orchestrator/temporal/config.js';
import { dispatchGenerateToHttpWorker, probeMediaDurations } from './dispatch-http.js';

const WORKER_V2_URL = process.env.WORKER_V2_URL;
const WORKER_SECRET = process.env.WORKER_SECRET;
const DISPATCH_FAILED_PENDING_REFUND = 'DISPATCH_FAILED_PENDING_REFUND';
const DISPATCH_FAILED_FINAL = 'DISPATCH_FAILED';

// No rate_run / auto-judge scoring pipeline in this repo yet (a separate,
// larger piece of upstream — see the upstream-comparison report), so
// model: "auto" always resolves against an empty stats map and therefore
// always picks the kind's default. Honest and safe: never a crash, never
// silent smart-routing that isn't actually happening.
const EMPTY_STATS: ModelStatsMap = {};

function buildCallbackUrl(jobId: string): string {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  return `${supabaseUrl}/functions/v1/webhook-provider?provider=railway&job_id=${jobId}`;
}

function parseKind(raw: string): GenerateKind | null {
  return raw === 'image' || raw === 'video' || raw === 'audio' ? raw : null;
}

async function markDispatchFailureAndRefund(
  jobId: string,
  userId: string,
  message: string,
): Promise<void> {
  const { data: claimedRows, error: updateErr } = await supabase
    .from('generation_jobs')
    .update({
      status: 'failed',
      error_code: DISPATCH_FAILED_PENDING_REFUND,
      error_message: message,
      webhook_checkpoint: 'failed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'submitted')
    .eq('webhook_checkpoint', 'none')
    .select('id');
  if (updateErr) {
    console.error(`[v2 generate] dispatch failure state update failed for ${jobId}: ${updateErr.message}`);
    return;
  }
  if (!claimedRows || claimedRows.length === 0) {
    console.warn(`[v2 generate] dispatch failure update skipped for ${jobId} (job already advanced/settled); refund skipped`);
    return;
  }

  const { error } = await supabase.rpc('refund_credits', { p_job_id: jobId });
  if (error && !/ALREADY_REFUNDED/i.test(error.message)) {
    console.error(`[v2 generate] refund_credits failed after dispatch error (${jobId}): ${error.message}`);
    console.error(`[v2 generate] job ${jobId} left in ${DISPATCH_FAILED_PENDING_REFUND} for reconciler retry`);
    return;
  }

  const { error: finalizeErr } = await supabase
    .from('generation_jobs')
    .update({ error_code: DISPATCH_FAILED_FINAL })
    .eq('id', jobId)
    .eq('user_id', userId)
    .eq('status', 'failed')
    .eq('error_code', DISPATCH_FAILED_PENDING_REFUND);
  if (finalizeErr) {
    console.error(`[v2 generate] refund settled but failed to finalize dispatch error code for ${jobId}: ${finalizeErr.message}`);
  }
}

/** Video-only: measure video_refs durations via the worker so the quote bills them. */
async function videoQuoteExtras(kind: GenerateKind, body: unknown): Promise<{ inputVideoSeconds?: number }> {
  if (kind !== 'video' || !WORKER_V2_URL || !WORKER_SECRET) return {};
  const refs = (body as { video_refs?: unknown })?.video_refs;
  if (!Array.isArray(refs) || !refs.length) return {};
  const urls = refs.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, 10);
  if (!urls.length) return {};
  const durations = await probeMediaDurations(WORKER_V2_URL, WORKER_SECRET, urls);
  const total = Object.values(durations).reduce((sum: number, d) => sum + (typeof d === 'number' ? d : 0), 0);
  return total > 0 ? { inputVideoSeconds: total } : {};
}

/** POST /v2/quote/:kind — validate + price, no job row, no credits spent. */
export async function quoteGenerateRoute(req: Request, res: Response): Promise<void> {
  const kind = parseKind(String(req.params.kind ?? ''));
  if (!kind) {
    res.status(404).json({ error: { code: 'UNKNOWN_KIND', message: `unknown generate kind "${req.params.kind}" (image | video | audio)` } });
    return;
  }
  const extras = await videoQuoteExtras(kind, req.body);
  const result = quoteAny(kind, req.body, EMPTY_STATS, extras);
  if (!result.ok) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', issues: result.issues } });
    return;
  }
  res.status(200).json({ ...result.quote, ...(result.auto ? { auto: result.auto } : {}) });
}

export async function generateRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId as string;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const kind = parseKind(String(req.params.kind ?? ''));
  if (!kind) {
    res.status(404).json({ error: { code: 'UNKNOWN_KIND', message: `unknown generate kind "${req.params.kind}" (image | video | audio)` } });
    return;
  }

  // ── 1. Validate + price (also resolves model: "auto") ─────────────
  const extras = await videoQuoteExtras(kind, req.body);
  const result = quoteAny(kind, req.body, EMPTY_STATS, extras);
  if (!result.ok) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', issues: result.issues } });
    return;
  }
  const { quote, input } = result;

  // ── 2. Worker preflight ────────────────────────────────────────────
  const engine = getOrchestratorEngine();
  if (engine !== 'http') {
    res.status(503).json({
      error: {
        code: 'ORCHESTRATOR_NOT_SUPPORTED',
        message: 'The loose generate surface only supports the http orchestrator engine today.',
      },
    });
    return;
  }
  if (!WORKER_V2_URL || !WORKER_SECRET) {
    res.status(503).json({ error: { code: 'WORKER_NOT_CONFIGURED', message: 'Generation service is not configured.' } });
    return;
  }

  // ── 3. Insert job row ──────────────────────────────────────────────
  const jobId = crypto.randomUUID();
  const promptText = kind === 'audio' ? (input as { text: string }).text : (input as { prompt: string }).prompt;
  const { error: jobErr } = await supabase.from('generation_jobs').insert({
    id: jobId,
    user_id: userId,
    model_slug: quote.model,
    operation: `generate_${kind}`,
    status: 'submitted',
    prompt: promptText,
    credit_cost: quote.credits,
    provider_slug: 'railway',
    provider_job_id: jobId,
    input_params: input,
  });
  if (jobErr) {
    console.error('[v2 generate] job insert failed:', jobErr.message);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to create job' } });
    return;
  }

  // ── 4. Deduct credits (refund-on-fail handled by webhook / dispatch catch) ──
  const { error: creditErr } = await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: quote.credits,
    p_job_id: jobId,
    p_description: `${quote.model} · ${quote.breakdown}`,
  });
  if (creditErr) {
    await supabase.from('generation_jobs').delete().eq('id', jobId);
    const msg = creditErr.message || '';
    const code = /INSUFFICIENT_CREDITS/i.test(msg) ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED';
    res.status(code === 'INSUFFICIENT_CREDITS' ? 402 : 500).json({ error: { code, message: msg || 'Credit deduction failed' } });
    return;
  }

  // ── 5. Dispatch to worker ──────────────────────────────────────────
  const videoInput = kind === 'video' ? (input as any) : null;
  const payload = {
    job_id: jobId,
    user_id: userId,
    callback_url: buildCallbackUrl(jobId),
    model: quote.model,
    ...(kind === 'audio'
      ? { text: (input as any).text, voice: (input as any).voice, tone: (input as any).tone }
      : kind === 'image'
        ? { prompt: (input as any).prompt, refs: (input as any).refs ?? [], size: (input as any).size }
        : {
            prompt: videoInput.prompt,
            mode: quote.mode ?? deriveVideoMode(videoInput),
            first_frame: videoInput.first_frame,
            last_frame: videoInput.last_frame,
            refs: videoInput.refs ?? [],
            video_refs: videoInput.video_refs ?? [],
            audio_refs: videoInput.audio_refs ?? [],
            seconds: videoInput.seconds,
            aspect: videoInput.aspect,
            quality: quote.quality ?? videoInput.quality,
            audio: videoInput.audio,
            timeout_minutes: undefined,
          }),
  };

  try {
    await dispatchGenerateToHttpWorker(WORKER_V2_URL, WORKER_SECRET, kind, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[v2 generate] worker dispatch failed: ${msg}`);
    await markDispatchFailureAndRefund(jobId, userId, `Worker dispatch failed: ${msg}`);
    res.status(503).json({
      error: { code: 'ORCHESTRATOR_UNAVAILABLE', message: 'Generation worker is currently unavailable. Credits were refunded.' },
    });
    return;
  }

  // ── 6. Respond ──────────────────────────────────────────────────────
  res.status(201).json({
    job_id: jobId,
    status: 'submitted',
    credits_deducted: quote.credits,
    model: quote.model,
    breakdown: quote.breakdown,
  });
}
