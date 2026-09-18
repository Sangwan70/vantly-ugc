// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Pure aggregation logic for GET /v1/social/performance (Video Generation
 * Flow audit, §6 improvement #7: "close the loop with published
 * performance data ... even a simple 'this hook/actor combo performed
 * better' view"). Deliberately has NO supabase/server import -- same "pure
 * module" convention as make-ugc-router.ts's decideMakeUgcRoute/
 * scorePrePublishChecklist -- so it can be unit-tested without a live DB
 * connection or SUPABASE_* env vars. routes/v1/social.ts does the actual
 * I/O (fetching vantly_publications + skill_runs/primitive_runs rows) and
 * calls rollupPerformance with the results.
 */

export interface PerformancePublication {
  id: string;
  integration_id: string;
  run_id: string | null;
  source: string | null;
  release_url: string | null;
  published_at: string | null;
  /** From classifyHookOpener (make-ugc-router.ts) against the generation's
   *  own script -- the same weak/direct split improvement #6's checklist
   *  warns about at dispatch time, now compared against what actually
   *  happened after publish. */
  hook: 'no_script' | 'weak_opener' | 'direct_opener';
  /** The generation's saved character id (props.character), falling back
   *  to an ad-hoc uploaded person image URL (props.person) when there's no
   *  saved character -- the latter is a weaker grouping key (a fresh
   *  upload URL rarely repeats across runs) but still a valid one. NULL
   *  for scene_action-only/product clips with neither. */
  actor: string | null;
  caption_style: string | null;
  metrics: { views: number | null; completion_rate: number | null; ctr: number | null; updated_at: string | null };
}

export interface PerformanceRollupEntry {
  key: string;
  count: number;
  avg_views: number | null;
  avg_completion_rate: number | null;
  avg_ctr: number | null;
}

export function averageOf(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Groups publications by `keyOf` (null ⇒ excluded from every group, e.g. no
 * resolved actor), averaging each recorded metric independently -- a group
 * where only some rows have e.g. completion_rate still gets a real average
 * from the rows that do, rather than being dragged down by nulls or
 * dropped entirely. Sorted by avg_views descending (groups with no views
 * data sort last), since views is the metric every platform's own
 * analytics exposes, so it's the one every group is most likely to have.
 */
export function rollupPerformance(
  publications: PerformancePublication[],
  keyOf: (p: PerformancePublication) => string | null,
): PerformanceRollupEntry[] {
  const groups = new Map<string, PerformancePublication[]>();
  for (const p of publications) {
    const key = keyOf(p);
    if (key === null) continue;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }
  const entries: PerformanceRollupEntry[] = Array.from(groups.entries()).map(([key, group]) => ({
    key,
    count: group.length,
    avg_views: averageOf(group.map((g) => g.metrics.views).filter((v): v is number => v !== null)),
    avg_completion_rate: averageOf(
      group.map((g) => g.metrics.completion_rate).filter((v): v is number => v !== null),
    ),
    avg_ctr: averageOf(group.map((g) => g.metrics.ctr).filter((v): v is number => v !== null)),
  }));
  entries.sort((a, b) => (b.avg_views ?? -1) - (a.avg_views ?? -1));
  return entries;
}
