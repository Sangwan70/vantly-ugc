// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Auto-top-up configuration and processing, ported from
 * supabase/functions/auto-topup (a Supabase Edge Function) — see
 * checkout.ts's file comment for why this self-hosted deployment needs
 * api-v2 routes instead of Edge Functions.
 *
 * Routes (registered in server.ts):
 *   GET  /v1/billing/auto-topup          (authMiddleware) — return the
 *     user's config (or defaults)
 *   POST /v1/billing/auto-topup          (authMiddleware) — upsert the
 *     user's config. apps/web's invokeFn proxy always sends the config
 *     fields on this POST (see apps/web/lib/supabase/fn-proxy.ts +
 *     dashboard/billing/page.tsx), so unlike the original Edge Function
 *     (which had to content-sniff the body to disambiguate a user config
 *     write from a service-role "process top-ups" call arriving at the
 *     SAME path with no Express-style auth layer in front of it) this
 *     route only ever needs to handle the config-write case — every
 *     caller that reaches it has already passed authMiddleware, so it can
 *     never be the service-role cron call.
 *   POST /v1/billing/auto-topup/process  (NO authMiddleware — service-role
 *     bearer key checked inline, same contract as the original) — process
 *     pending auto-top-ups. Split onto its own path specifically so it
 *     stays reachable despite the route above now requiring a user JWT.
 *     Nothing in this codebase currently calls it (no cron/scheduled task
 *     wires it up) — ported for parity, in case an operator adds one later.
 *
 * No rate limiting is reimplemented for the two user-facing routes (unlike
 * the Edge Function, which deliberately had NONE on this endpoint — see
 * its own comment: the old shared rate-limit module counted all endpoint
 * calls per user, so a normal page load could burn through the free-tier
 * budget before a user ever touched the toggle). api-v2's registration
 * uses readLimiter (GET) / generateLimiter (POST) like every other v1
 * route — both far more generous than that old per-endpoint scheme was.
 * The /process path is registered with no per-user limiter (it has no
 * user) but still sits behind the global ipFloodLimiter like every route.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../../server.js';

interface AutoTopUpConfig {
  enabled: boolean;
  threshold_credits: number;
  pack_slug: string;
  max_monthly_topups: number;
}

const VALID_PACK_SLUGS = new Set(['pack_3900']);
const MIN_THRESHOLD = 10;
const MIN_MAX_MONTHLY = 1;
const MAX_MAX_MONTHLY = 10;

const DEFAULT_CONFIG: AutoTopUpConfig = {
  enabled: false,
  threshold_credits: 50,
  pack_slug: 'pack_3900',
  max_monthly_topups: 3,
};

export async function autoTopupGetConfigRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }

  const { data, error: fetchError } = await supabase
    .from('auto_topup_config')
    .select('enabled, threshold_credits, pack_slug, max_monthly_topups, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    console.error('Failed to fetch auto-topup config:', fetchError.message);
    res.status(500).json({ error: 'server_error', error_description: 'Failed to fetch auto-top-up configuration' });
    return;
  }

  res.status(200).json(data ?? { ...DEFAULT_CONFIG, updated_at: null });
}

async function handlePutConfig(req: Request, res: Response, userId: string): Promise<void> {
  const body = (req.body ?? {}) as Partial<AutoTopUpConfig>;

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    res.status(400).json({ error: 'invalid_request', error_description: 'enabled must be a boolean' });
    return;
  }

  if (body.threshold_credits !== undefined) {
    if (typeof body.threshold_credits !== 'number' || !Number.isInteger(body.threshold_credits) || body.threshold_credits < MIN_THRESHOLD) {
      res.status(400).json({ error: 'invalid_request', error_description: `threshold_credits must be an integer >= ${MIN_THRESHOLD}` });
      return;
    }
  }

  if (body.pack_slug !== undefined) {
    if (typeof body.pack_slug !== 'string' || !VALID_PACK_SLUGS.has(body.pack_slug)) {
      res.status(400).json({ error: 'invalid_request', error_description: `pack_slug must be one of: ${[...VALID_PACK_SLUGS].join(', ')}` });
      return;
    }
  }

  if (body.max_monthly_topups !== undefined) {
    if (
      typeof body.max_monthly_topups !== 'number' ||
      !Number.isInteger(body.max_monthly_topups) ||
      body.max_monthly_topups < MIN_MAX_MONTHLY ||
      body.max_monthly_topups > MAX_MAX_MONTHLY
    ) {
      res.status(400).json({ error: 'invalid_request', error_description: `max_monthly_topups must be an integer between ${MIN_MAX_MONTHLY} and ${MAX_MAX_MONTHLY}` });
      return;
    }
  }

  const upsertData: Record<string, unknown> = {
    user_id: userId,
    enabled: body.enabled ?? DEFAULT_CONFIG.enabled,
    threshold_credits: body.threshold_credits ?? DEFAULT_CONFIG.threshold_credits,
    pack_slug: body.pack_slug ?? DEFAULT_CONFIG.pack_slug,
    max_monthly_topups: body.max_monthly_topups ?? DEFAULT_CONFIG.max_monthly_topups,
    updated_at: new Date().toISOString(),
  };

  const { data, error: upsertError } = await supabase
    .from('auto_topup_config')
    .upsert(upsertData, { onConflict: 'user_id' })
    .select('enabled, threshold_credits, pack_slug, max_monthly_topups, updated_at')
    .single();

  if (upsertError) {
    console.error('Failed to upsert auto-topup config:', upsertError.message);
    res.status(500).json({ error: 'server_error', error_description: 'Failed to update auto-top-up configuration' });
    return;
  }

  res.status(200).json(data);
}

/**
 * Service-role-only: process pending auto-top-ups (intended for a cron
 * job). Nothing in this codebase currently schedules a call to this route
 * — ported for parity with the original, in case an operator wires up a
 * cron trigger later (e.g. via a scheduled task hitting this with the
 * service-role key as bearer auth, same contract as the original).
 */
async function handleProcessTopUps(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!token || !serviceRoleKey || token !== serviceRoleKey) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Service role key required' });
    return;
  }

  const { data: configs, error: configError } = await supabase
    .from('auto_topup_config')
    .select('user_id, threshold_credits, pack_slug, max_monthly_topups')
    .eq('enabled', true);

  if (configError) {
    console.error('Failed to fetch auto-topup configs:', configError.message);
    res.status(500).json({ error: 'server_error', error_description: 'Failed to fetch auto-top-up configurations' });
    return;
  }

  const results: Array<{ user_id: string; should_topup: boolean; error?: string }> = [];

  for (const config of configs ?? []) {
    try {
      const { data: checkResult, error: checkError } = await supabase.rpc('check_and_topup', { p_user_id: config.user_id });

      if (checkError) {
        results.push({ user_id: config.user_id, should_topup: false, error: checkError.message });
        continue;
      }

      const shouldTopup = checkResult?.should_topup === true;
      results.push({ user_id: config.user_id, should_topup: shouldTopup });

      if (shouldTopup) {
        console.log(`auto-topup: user ${config.user_id} needs top-up (pack: ${config.pack_slug}, threshold: ${config.threshold_credits})`);
      }
    } catch (err) {
      results.push({ user_id: config.user_id, should_topup: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  const triggered = results.filter((r) => r.should_topup).length;
  console.log(`auto-topup: processed ${results.length} configs, ${triggered} need top-up`);

  res.status(200).json({ processed: results.length, triggered, results });
}

/**
 * POST /v1/billing/auto-topup (authMiddleware) — always a user config
 * write; every caller here already carries a verified user JWT.
 */
export async function autoTopupPostRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Authentication required' });
    return;
  }
  await handlePutConfig(req, res, userId);
}

/**
 * POST /v1/billing/auto-topup/process (service-role only, no
 * authMiddleware) — process pending auto-top-ups. See file comment.
 */
export async function autoTopupProcessRoute(req: Request, res: Response): Promise<void> {
  await handleProcessTopUps(req, res);
}
