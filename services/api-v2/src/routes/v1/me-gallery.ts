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
import { deriveEffectiveSkillRunStatus, computeRunHealth } from '../../lib/skill-run-status.js';

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
  // Story title (currently only ever set by make_storybook's optional
  // `title` input field — see skills/registry.ts's MakeStorybookSkillInputSchema).
  // NULL for every other skill/primitive and for the legacy path; callers
  // (e.g. dashboard/social's video picker) should fall back to `prompt`/
  // `primitive` the same way this route's own promptText derivation does.
  title: string | null;
  credits_deducted: number;
  // Only ever set (true) for a 'vnext_skill' item whose parent run looks
  // stuck -- see lib/skill-run-status.ts's computeRunHealth. Same signal
  // GET /v1/skills/runs/:id exposes, computed the same way, so the jobs
  // list and the run-detail page can never silently disagree about it.
  stalled: boolean;
  stalled_for_seconds: number | null;
  // Set only for a row pushed into this user's gallery by an admin (see
  // apps/web's app/api/admin/gallery/share/route.ts) -- never something the
  // user generated themselves. The frontend renders a "Shared by X" badge
  // and never offers delete/retry for these (admin-controlled admin-side).
  shared: boolean;
  shared_by: string | null;
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
  // Free-text AJAX search (e.g. the admin blog editor's "pick a generation"
  // picker) — matched against the extracted prompt/primitive below, post-fetch,
  // since the three source tables don't share a single searchable text column.
  const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;
  // Media-type filter (currently only 'video') — e.g. the admin blog
  // editor's picker only wants generations it can embed as a <video>, not
  // portraits/character sheets/stills, which don't make sense as the
  // subject of a blog post generated from "the prompt of the video".
  // Matched by file extension against media_url, same convention
  // dashboard/social/page.tsx already uses to tell video vs image apart.
  const mediaFilter = req.query.media ? String(req.query.media).trim().toLowerCase() : null;
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
      'id, skill_slug, skill_version, status, current_step, started_at, finished_at, created_at, final_output, input, error_code, error_message, credits_deducted_total:primitive_runs(credits_deducted)',
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

  // ── vNext: each composed skill run's CHILD primitive_runs (steps), keyed
  // by skill_run_id. A composed run's `final_output` (used below) is only
  // ever written once by the workflow, at the very end, after every step —
  // including an optional one like subtitles — has succeeded (see
  // workflows/make-ugc-video.ts). If ANY step fails, or the client that
  // was watching gave up before the workflow finished, `final_output` stays
  // null forever even though earlier steps genuinely succeeded, got
  // uploaded to R2, and were paid for. Fetching the real per-step artifacts
  // here lets the loop below fall back to them so those artifacts still
  // show up instead of a single contentless "failed" placeholder.
  const skillRunIds = (skillRuns ?? []).map((r) => r.id as string);
  const childrenBySkillRun = new Map<
    string,
    Array<{
      status: string;
      primitive_id: string | null;
      started_at: string | null;
      finished_at: string | null;
      error_code: string | null;
      error_message: string | null;
      primitive_artifacts: Array<{ url: string; kind: string }>;
    }>
  >();
  if (skillRunIds.length > 0) {
    const { data: children } = await supabase
      .from('primitive_runs')
      .select('skill_run_id, status, primitive_id, started_at, finished_at, error_code, error_message, primitive_artifacts(url, kind, mime, bytes)')
      .in('skill_run_id', skillRunIds);
    for (const c of children ?? []) {
      const key = c.skill_run_id as string;
      const list = childrenBySkillRun.get(key) ?? [];
      list.push(c as unknown as {
        status: string;
        primitive_id: string | null;
        started_at: string | null;
        finished_at: string | null;
        error_code: string | null;
        error_message: string | null;
        primitive_artifacts: Array<{ url: string; kind: string }>;
      });
      childrenBySkillRun.set(key, list);
    }
    // Tolerate a lookup failure silently — worst case we fall back to the
    // final_output-only behavior this replaces, not a hard error.
  }
  // kind → which final_output field it would have filled, so the fallback
  // below reads the same artifact regardless of which one populated it.
  function findChildArtifact(skillRunId: string, kinds: string[]): { url: string; status: string } | null {
    for (const c of childrenBySkillRun.get(skillRunId) ?? []) {
      const arts = c.primitive_artifacts ?? [];
      const hit = arts.find((a) => kinds.includes(a.kind) && a.url);
      if (hit) return { url: hit.url, status: c.status };
    }
    return null;
  }

  const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?|$|#)/i;

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
      title: null,
      credits_deducted: Number(row.credit_cost ?? 0),
      stalled: false,
      stalled_for_seconds: null,
      shared: false,
      shared_by: null,
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
    // Only make_storybook's input schema has a `title` field today (see
    // skills/registry.ts) — every other skill leaves this null, so callers
    // must still fall back to promptText/primitive the way dashboard/social
    // already does for the caption.
    const titleText: string | null =
      (typeof inp.title === 'string' && inp.title.trim()) ? inp.title.trim() : null;
    const totalCredits = ((row.credits_deducted_total as any) || []).reduce(
      (s: number, c: any) => s + Number(c?.credits_deducted ?? 0),
      0,
    );
    const children = childrenBySkillRun.get(row.id as string) ?? [];
    // Same derivation getSkillRunRoute applies (lib/skill-run-status.ts) --
    // this is the actual fix for the jobs-list-vs-run-detail-page status
    // disagreement: both now compute status from the SAME function over
    // the SAME child rows instead of one endpoint deriving and the other
    // reading skill_runs.status raw.
    const { status: derivedStatus } = deriveEffectiveSkillRunStatus(
      { status: (row.status as string) ?? 'unknown', error_code: (row.error_code as string | null) ?? null, error_message: (row.error_message as string | null) ?? null },
      children.map((c) => ({ status: c.status, primitive_id: c.primitive_id ?? '', error_code: c.error_code, error_message: c.error_message })),
    );
    const health = computeRunHealth(
      { status: derivedStatus, started_at: row.started_at as string | null },
      row.skill_slug as string | null,
      row.current_step as string | null,
      children.map((c) => ({ status: c.status, started_at: c.started_at, finished_at: c.finished_at })),
    );
    const status = derivedStatus;
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
    // Fall back to each step's own artifact when final_output never got
    // that field set — e.g. the workflow's outer catch block never writes
    // final_output at all on failure (see workflows/make-ugc-video.ts), so
    // an earlier step that genuinely succeeded (and was paid for) would
    // otherwise vanish from every gallery/jobs view entirely.
    const portraitFallback = !out.portrait_url ? findChildArtifact(row.id as string, ['portrait']) : null;
    const sheetFallback = !out.character_sheet_url ? findChildArtifact(row.id as string, ['character_sheet']) : null;
    const videoFallback = !out.video_url ? findChildArtifact(row.id as string, ['subtitled_video', 'selfie_video']) : null;

    let emitted = false;
    if (out.portrait_url || portraitFallback) {
      items.push({
        id: `${row.id}-portrait`,
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: 'portrait_gpt2',
        status: portraitFallback ? portraitFallback.status : status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.portrait_url ?? portraitFallback?.url ?? null,
        thumbnail_url: out.portrait_url ?? portraitFallback?.url ?? null,
        duration_seconds: null,
        prompt: null,
        title: null,
        credits_deducted: 0,
        stalled: health.stalled,
        stalled_for_seconds: health.stalled_for_seconds,
        shared: false,
        shared_by: null,
      });
      emitted = true;
    }
    if (out.character_sheet_url || sheetFallback) {
      items.push({
        id: `${row.id}-character-sheet`,
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: 'character_sheet_gpt2',
        status: sheetFallback ? sheetFallback.status : status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.character_sheet_url ?? sheetFallback?.url ?? null,
        thumbnail_url: out.character_sheet_url ?? sheetFallback?.url ?? null,
        duration_seconds: null,
        prompt: null,
        title: null,
        credits_deducted: 0,
        stalled: health.stalled,
        stalled_for_seconds: health.stalled_for_seconds,
        shared: false,
        shared_by: null,
      });
      emitted = true;
    }
    if (out.video_url || videoFallback) {
      items.push({
        id: emitted ? `${row.id}-video` : (row.id as string),
        run_id: row.id as string,
        source: 'vnext_skill',
        primitive: (row.skill_slug as string) ?? null,
        status: videoFallback ? videoFallback.status : status,
        created_at: createdAt,
        finished_at: finishedAt,
        media_url: out.video_url ?? videoFallback?.url ?? null,
        thumbnail_url: out.character_sheet_url ?? out.portrait_url ?? sheetFallback?.url ?? portraitFallback?.url ?? null,
        duration_seconds: durationSeconds,
        prompt: promptText,
        title: titleText,
        credits_deducted: totalCredits,
        stalled: health.stalled,
        stalled_for_seconds: health.stalled_for_seconds,
        shared: false,
        shared_by: null,
      });
      emitted = true;
    }
    // A skill run with no artifact URLs at all — from final_output OR any
    // child step — still gets one placeholder row so it shows up as
    // in-progress/failed rather than silently vanishing.
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
        title: null,
        credits_deducted: totalCredits,
        stalled: health.stalled,
        stalled_for_seconds: health.stalled_for_seconds,
        shared: false,
        shared_by: null,
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
      title: null,
      credits_deducted: Number(row.credits_deducted ?? 0),
      stalled: false,
      stalled_for_seconds: null,
      shared: false,
      shared_by: null,
    });
  }

  // ── Admin-shared items: pushed into this user's gallery by an admin
  // (apps/web's app/api/admin/gallery/share/route.ts), never generated by
  // this user. Denormalized snapshot -- see the gallery_shares migration's
  // header comment -- so this stays correct even if the source run is later
  // deleted or the sharing admin's account changes.
  const { data: shares, error: sharesErr } = await supabase
    .from('gallery_shares')
    .select('id, source_kind, source_run_id, primitive, media_url, thumbnail_url, duration_seconds, title, prompt, created_at, shared_by_label')
    .eq('shared_with_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(fetchCap);
  if (sharesErr && sharesErr.code !== '42P01') {
    res.status(500).json({ error: 'gallery_shares_lookup_failed', detail: sharesErr.message });
    return;
  }
  for (const row of shares ?? []) {
    items.push({
      id: `share-${row.id}`,
      run_id: (row.source_run_id as string | null) ?? (row.id as string),
      source: (row.source_kind as GalleryItem['source']) ?? 'vnext_primitive',
      primitive: (row.primitive as string | null) ?? null,
      status: 'succeeded',
      created_at: row.created_at as string,
      finished_at: row.created_at as string,
      media_url: (row.media_url as string | null) ?? null,
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      duration_seconds: (row.duration_seconds as number | null) ?? null,
      prompt: (row.prompt as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      credits_deducted: 0,
      stalled: false,
      stalled_for_seconds: null,
      shared: true,
      shared_by: (row.shared_by_label as string | null) ?? null,
    });
  }

  // Filter by tab — "selfies" keeps only video-output sources.
  let filtered = items;
  if (q) {
    filtered = filtered.filter(
      (it) => (it.prompt ?? '').toLowerCase().includes(q) || (it.primitive ?? '').toLowerCase().includes(q),
    );
  }
  if (mediaFilter === 'video') {
    filtered = filtered.filter((it) => !!it.media_url && VIDEO_EXT_RE.test(it.media_url));
  }
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
  // Per-user private data -- never let a browser or intermediate proxy/CDN
  // cache this by URL alone (every user hits the exact same default URL,
  // '/v1/me/gallery?limit=40&offset=0', so a URL-keyed cache that ignores
  // the Authorization header would silently serve one user's gallery to
  // the next person who loads the page in a shared/cached path).
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({ items: page, offset, limit, returned: page.length, total, has_more: total > offset + limit });
}
