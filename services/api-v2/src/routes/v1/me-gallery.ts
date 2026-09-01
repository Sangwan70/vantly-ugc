// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /v1/me/gallery — merged "Recent generations" feed for the
 * authenticated user. Combines legacy `generation_jobs` and vNext
 * `primitive_runs` + `primitive_artifacts` into one date-sorted list.
 *
 * Each row has a stable shape regardless of source so the frontend can
 * render a single grid.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../server.js';

interface GalleryItem {
  id: string;
  // Real skill_runs/primitive_runs/generation_jobs row id — always a plain
  // UUID, safe to pass to /dashboard/skills/runs/:id or /v1/*/runs/:id. NOT
  // the same as `id` above for a composed skill run's portrait/character
  // sheet/video sub-items: those get a suffixed, non-UUID `id` (e.g.
  // "<uuid>-portrait") so each artifact renders as its own gallery row, but
  // they all still share ONE real run_id (the parent skill_runs.id) — that's
  // what "Details" must link to, or the lookup 400s on the fake id.
  run_id: string;
  source: 'legacy' | 'vnext_primitive' | 'vnext_skill';
  primitive: string | null;
  status: string;
  created_at: string;
  finished_at: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  prompt: string | null;
  credits_deducted: number;
}

export async function getMyGalleryRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? '40'), 10) || 40, 1),
    100,
  );
  const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const filter = String(req.query.filter ?? 'all').toLowerCase();
  const primitiveFilter = req.query.primitive ? String(req.query.primitive) : null;
  const skillFilter = req.query.skill ? String(req.query.skill) : null;
  // We fetch limit+offset from each source so we have enough rows to
  // merge, sort, and slice the requested page.
  const fetchCap = Math.min(limit + offset, 200);

  // ── Legacy generation_jobs (completed only, videos preferred)
  const { data: legacy, error: legacyErr } = await supabase
    .from('generation_jobs')
    .select(
      'id, model_slug, operation, status, prompt, output_media_url, output_thumbnail_url, duration_seconds, created_at, credit_cost',
    )
    .eq('user_id', userId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(fetchCap);
  // 42P01 = table missing → tolerate.
  if (legacyErr && legacyErr.code !== '42P01') {
    res.status(500).json({ error: 'legacy_lookup_failed', detail: legacyErr.message });
    return;
  }

  // ── vNext: skill_runs + their joined primitive_runs/artifacts
  const { data: skillRuns, error: skillErr } = await supabase
    .from('skill_runs')
    .select(
      'id, skill_slug, skill_version, status, current_step, started_at, finished_at, created_at, final_output, input, credits_deducted_total:primitive_runs(credits_deducted)',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(fetchCap);
  if (skillErr && skillErr.code !== '42P01') {
    res.status(500).json({ error: 'skill_runs_lookup_failed', detail: skillErr.message });
    return;
  }

  // ── vNext: standalone primitive_runs (no skill_run_id)
  const { data: primitiveRuns, error: primErr } = await supabase
    .from('primitive_runs')
    .select(
      'id, primitive_id, status, started_at, finished_at, created_at, credits_deducted, input, primitive_artifacts(url, kind, mime, bytes)',
    )
    .eq('user_id', userId)
    .is('skill_run_id', null)
    .order('created_at', { ascending: false })
    .limit(fetchCap);
  if (primErr && primErr.code !== '42P01') {
    res.status(500).json({ error: 'primitive_runs_lookup_failed', detail: primErr.message });
    return;
  }

  const items: GalleryItem[] = [];

  for (const row of legacy ?? []) {
    items.push({
      id: row.id as string,
      run_id: row.id as string,
      source: 'legacy',
      primitive: (row.operation as string | null) ?? null,
      status: (row.status as string) ?? 'unknown',
      created_at: row.created_at as string,
      finished_at: null,
      media_url: (row.output_media_url as string | null) ?? null,
      thumbnail_url: (row.output_thumbnail_url as string | null) ?? null,
      duration_seconds: (row.duration_seconds as number | null) ?? null,
      prompt: (row.prompt as string | null) ?? null,
      credits_deducted: Number(row.credit_cost ?? 0),
    });
  }

  for (const row of skillRuns ?? []) {
    const out = (row.final_output as any) || {};
    const inp = (row.input as any) || {};
    // What the caller actually asked for, in priority order: the spoken
    // script (make_ugc / make_ugc_video), then a silent scene_action
    // clip's description, then the freeform person description — this is
    // what /dashboard/social auto-fills as a starting caption so publishing
    // doesn't require retyping what the video already says.
    const promptText: string | null =
      (typeof inp.script === 'string' && inp.script.trim()) ? inp.script.trim() :
      (typeof inp.scene_action === 'string' && inp.scene_action.trim()) ? inp.scene_action.trim() :
      (typeof inp.person === 'string' && inp.person.trim()) ? inp.person.trim() :
      null;
    const totalCredits = ((row.credits_deducted_total as any) || []).reduce(
      (s: number, c: any) => s + Number(c?.credits_deducted ?? 0),
      0,
    );
    const status = (row.status as string) ?? 'unknown';
    const createdAt = row.created_at as string;
    const finishedAt = (row.finished_at as string | null) ?? null;
    const durationSeconds = (out.duration_seconds as number | null) ?? null;

    // Bugfix: this used to push ONE item per skill run, picking a single
    // media_url via video_url ?? character_sheet_url ?? portrait_url — so a
    // finished make_ugc_video run (which sets all three on final_output,
    // see workflows/make-ugc-video.ts) only ever surfaced its video. The
    // portrait (and character sheet) images were generated, uploaded to R2,
    // and recorded correctly, but never appeared anywhere in the gallery
    // feed at all — confirmed live: a succeeded run's dashboard "Images"
    // tab stayed empty even though portrait.png was reachable directly at
    // its R2 URL. Now emits one item per real artifact URL, same as the
    // standalone primitive_runs branch below already does — the client's
    // own HIDDEN_OPS list (apps/web .../gallery/page.tsx) is what decides
    // character-sheet visibility, same as for a standalone character-sheet
    // run, so this doesn't change what's shown for that one, only restores
    // the portrait and lets the video keep its own row.
    let emitted = false;
    if (out.portrait_url) {
      items.push({
        id: `${row.id}-portrait`,
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: 'portrait_gpt2',
        status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.portrait_url,
        thumbnail_url: out.portrait_url,
        duration_seconds: null,
        prompt: null,
        credits_deducted: 0,
      });
      emitted = true;
    }
    if (out.character_sheet_url) {
      items.push({
        id: `${row.id}-character-sheet`,
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: 'character_sheet_gpt2',
        status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.character_sheet_url,
        thumbnail_url: out.character_sheet_url,
        duration_seconds: null,
        prompt: null,
        credits_deducted: 0,
      });
      emitted = true;
    }
    if (out.video_url) {
      items.push({
        id: emitted ? `${row.id}-video` : (row.id as string),
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: (row.skill_slug as string) ?? null,
        status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.video_url,
        thumbnail_url: out.character_sheet_url ?? out.portrait_url ?? null,
        duration_seconds: durationSeconds,
        prompt: promptText,
        credits_deducted: totalCredits,
      });
      emitted = true;
    }
    // A skill run with no artifact URLs yet (still running, or failed
    // before producing anything) still gets one placeholder row so it
    // shows up as in-progress/failed rather than silently vanishing.
    if (!emitted) {
      items.push({
        id: row.id as string,
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: (row.skill_slug as string) ?? null,
        status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: null,
        thumbnail_url: null,
        duration_seconds: durationSeconds,
        prompt: null,
        credits_deducted: totalCredits,
      });
    }
  }

  for (const row of primitiveRuns ?? []) {
    const artifacts = (row.primitive_artifacts as Array<{ url: string; kind: string; mime: string | null }> | null) ?? [];
    const main = artifacts[0];
    items.push({
      id: row.id as string,
      run_id: row.id as string,
      source: 'vnext_primitive',
      primitive: (row.primitive_id as string) ?? null,
      status: (row.status as string) ?? 'unknown',
      created_at: row.created_at as string,
      finished_at: (row.finished_at as string | null) ?? null,
      media_url: main?.url ?? null,
      thumbnail_url: main?.kind === 'selfie_video' ? null : (main?.url ?? null),
      duration_seconds: (row.input as any)?.duration ?? null,
      prompt:
        (row.input as any)?.description ??
        (row.input as any)?.script ??
        null,
      credits_deducted: Number(row.credits_deducted ?? 0),
    });
  }

  // Filter by tab — "selfies" keeps only video-output sources.
  let filtered = items;
  if (filter === 'selfies') {
    filtered = items.filter(
      (it) =>
        it.primitive === 'selfie' ||
        it.primitive === 'simple_selfie' ||
        it.primitive === 'make_ugc_video',
    );
  }
  if (primitiveFilter) {
    filtered = filtered.filter((it) => it.primitive === primitiveFilter);
  }
  if (skillFilter) {
    filtered = filtered.filter((it) => it.primitive === skillFilter);
  }

  filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  res.status(200).json({ items: page, offset, limit, returned: page.length, total, has_more: total > offset + limit });
}
