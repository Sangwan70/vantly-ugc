// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * /v1/runs — hard-delete endpoints for the Jobs page cleanup feature
 * (dashboard/jobs "Purge failed" + per-row "Delete").
 *
 * This is a GENUINE, IRREVERSIBLE hard delete: it removes the R2-hosted
 * media/thumbnail objects the run produced, then removes the database
 * row(s) outright (relying on existing ON DELETE CASCADE for vNext child
 * tables). This is intentionally different from the existing agent
 * chats/projects "soft archive only" convention (see agent-chats.ts) —
 * that convention exists to preserve skill_run audit links from a chat;
 * here the run itself is what's being purged, by the run's own owner,
 * and the user has explicitly asked for real deletion of the resources.
 *
 * credit_transactions rows are NEVER touched by this file. They are an
 * immutable ledger (DB trigger prevent_credit_transaction_modification
 * rejects UPDATE/DELETE outright) and are only ever matched by
 * reference_id for audit purposes elsewhere in the codebase.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../server.js';
import { deleteR2ObjectsByUrl } from '../../lib/r2-upload.js';

type RunSource = 'legacy' | 'vnext_skill' | 'vnext_primitive';

const TERMINAL_LEGACY = new Set(['completed', 'failed', 'canceled']);
const TERMINAL_VNEXT = new Set(['succeeded', 'failed', 'canceled']);

/** Pulls every string value that looks like an http(s) URL out of an arbitrary JSON blob (skill_runs.final_output has a handful of *_url keys, e.g. portrait_url/character_sheet_url/video_url — collecting generically means a new artifact key added later doesn't silently leak an orphaned R2 object). */
function collectUrlsFromJson(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrlsFromJson(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectUrlsFromJson(v, out);
  }
}

/**
 * Gathers every R2 URL owned by one run (across sources) without deleting
 * anything yet, so a single-run delete and the bulk purge can share the
 * exact same collection logic.
 */
async function gatherRunUrls(
  source: RunSource,
  id: string,
  userId: string,
): Promise<{ found: boolean; status: string | null; urls: string[] } | { found: false; status: null; urls: [] }> {
  if (source === 'legacy') {
    const { data, error } = await supabase
      .from('generation_jobs')
      .select('id, status, output_media_url, output_thumbnail_url')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return { found: false, status: null, urls: [] };
    const urls: string[] = [];
    if (data.output_media_url) urls.push(data.output_media_url as string);
    if (data.output_thumbnail_url) urls.push(data.output_thumbnail_url as string);
    return { found: true, status: data.status as string, urls };
  }

  if (source === 'vnext_skill') {
    const { data, error } = await supabase
      .from('skill_runs')
      .select('id, status, final_output')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return { found: false, status: null, urls: [] };
    const urls: string[] = [];
    collectUrlsFromJson(data.final_output, urls);
    // Child primitive_runs' own artifacts (in case a step recorded a URL
    // that never made it into final_output, e.g. a failed later step).
    const { data: children } = await supabase
      .from('primitive_runs')
      .select('id, primitive_artifacts(url)')
      .eq('skill_run_id', id);
    for (const child of children ?? []) {
      const artifacts = (child.primitive_artifacts as Array<{ url: string }> | null) ?? [];
      for (const a of artifacts) if (a.url) urls.push(a.url);
    }
    return { found: true, status: data.status as string, urls };
  }

  // vnext_primitive: standalone primitive_runs (skill_run_id IS NULL).
  const { data, error } = await supabase
    .from('primitive_runs')
    .select('id, status, skill_run_id, primitive_artifacts(url)')
    .eq('id', id)
    .eq('user_id', userId)
    .is('skill_run_id', null)
    .maybeSingle();
  if (error || !data) return { found: false, status: null, urls: [] };
  const urls: string[] = [];
  const artifacts = (data.primitive_artifacts as Array<{ url: string }> | null) ?? [];
  for (const a of artifacts) if (a.url) urls.push(a.url);
  return { found: true, status: data.status as string, urls };
}

async function deleteRunRow(source: RunSource, id: string, userId: string): Promise<{ error: string | null }> {
  const table = source === 'legacy' ? 'generation_jobs' : source === 'vnext_skill' ? 'skill_runs' : 'primitive_runs';
  const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId);
  return { error: error ? error.message : null };
}

/**
 * DELETE /v1/runs/:id?source=legacy|vnext_skill|vnext_primitive
 *
 * Hard-deletes one run: its R2 media/thumbnail objects, then the DB row
 * (vNext children cascade via existing FKs). Refuses to delete a run
 * that's still in flight (submitted/running/processing) — finish or
 * cancel it first, so the worker doesn't keep writing to a deleted row.
 */
export async function deleteRunRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as unknown as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });
    return;
  }
  const id = String(req.params.id);
  const source = String(req.query.source ?? '') as RunSource;
  if (!['legacy', 'vnext_skill', 'vnext_primitive'].includes(source)) {
    res.status(400).json({ error: { code: 'INVALID_SOURCE', message: "source must be 'legacy', 'vnext_skill', or 'vnext_primitive'" } });
    return;
  }

  const run = await gatherRunUrls(source, id, userId);
  if (!run.found) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    return;
  }
  const terminal = source === 'legacy' ? TERMINAL_LEGACY.has(run.status ?? '') : TERMINAL_VNEXT.has(run.status ?? '');
  if (!terminal) {
    res.status(409).json({
      error: {
        code: 'RUN_IN_PROGRESS',
        message: `Run is still ${run.status} — wait for it to finish (or fail) before deleting`,
      },
    });
    return;
  }

  const r2Result = await deleteR2ObjectsByUrl(run.urls);
  const { error: dbError } = await deleteRunRow(source, id, userId);
  if (dbError) {
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: dbError }, r2: r2Result });
    return;
  }
  res.status(200).json({ deleted: true, r2: r2Result });
}

/**
 * POST /v1/runs/purge-failed
 *
 * Hard-deletes every one of the caller's own runs currently in a terminal
 * "failed" state, across all three run tables. A failed skill_runs row is
 * deleted (not its individual child primitive_runs) — the FK cascade takes
 * the children with it regardless of each child's own status, so a step
 * that failed inside an otherwise-recovered skill run is never purged out
 * from under a run that isn't itself failed.
 */
export async function purgeFailedRunsRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as unknown as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });
    return;
  }

  const allUrls: string[] = [];
  const counts = { legacy: 0, vnext_skill: 0, vnext_primitive: 0 };

  const { data: failedLegacy, error: legacyErr } = await supabase
    .from('generation_jobs')
    .select('id, output_media_url, output_thumbnail_url')
    .eq('user_id', userId)
    .eq('status', 'failed');
  if (legacyErr && legacyErr.code !== '42P01') {
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: legacyErr.message } });
    return;
  }
  const legacyIds = (failedLegacy ?? []).map((r) => r.id as string);
  for (const row of failedLegacy ?? []) {
    if (row.output_media_url) allUrls.push(row.output_media_url as string);
    if (row.output_thumbnail_url) allUrls.push(row.output_thumbnail_url as string);
  }

  const { data: failedSkillRuns, error: skillErr } = await supabase
    .from('skill_runs')
    .select('id, final_output')
    .eq('user_id', userId)
    .eq('status', 'failed');
  if (skillErr && skillErr.code !== '42P01') {
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: skillErr.message } });
    return;
  }
  const skillRunIds = (failedSkillRuns ?? []).map((r) => r.id as string);
  for (const row of failedSkillRuns ?? []) {
    collectUrlsFromJson(row.final_output, allUrls);
  }
  if (skillRunIds.length > 0) {
    const { data: childArtifacts } = await supabase
      .from('primitive_runs')
      .select('primitive_artifacts(url)')
      .in('skill_run_id', skillRunIds);
    for (const child of childArtifacts ?? []) {
      const artifacts = (child.primitive_artifacts as Array<{ url: string }> | null) ?? [];
      for (const a of artifacts) if (a.url) allUrls.push(a.url);
    }
  }

  const { data: failedPrimitives, error: primErr } = await supabase
    .from('primitive_runs')
    .select('id, primitive_artifacts(url)')
    .eq('user_id', userId)
    .eq('status', 'failed')
    .is('skill_run_id', null);
  if (primErr && primErr.code !== '42P01') {
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: primErr.message } });
    return;
  }
  const primitiveIds = (failedPrimitives ?? []).map((r) => r.id as string);
  for (const row of failedPrimitives ?? []) {
    const artifacts = (row.primitive_artifacts as Array<{ url: string }> | null) ?? [];
    for (const a of artifacts) if (a.url) allUrls.push(a.url);
  }

  const r2Result = await deleteR2ObjectsByUrl(allUrls);

  if (legacyIds.length > 0) {
    const { error } = await supabase.from('generation_jobs').delete().in('id', legacyIds).eq('user_id', userId);
    if (!error) counts.legacy = legacyIds.length;
  }
  if (skillRunIds.length > 0) {
    const { error } = await supabase.from('skill_runs').delete().in('id', skillRunIds).eq('user_id', userId);
    if (!error) counts.vnext_skill = skillRunIds.length;
  }
  if (primitiveIds.length > 0) {
    const { error } = await supabase.from('primitive_runs').delete().in('id', primitiveIds).eq('user_id', userId);
    if (!error) counts.vnext_primitive = primitiveIds.length;
  }

  res.status(200).json({ deleted: counts, r2: r2Result });
}
