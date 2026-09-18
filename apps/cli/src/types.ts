// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * CLI-specific type definitions.
 */

export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  profile?: string;
}

export type OutputMode = 'human' | 'json' | 'quiet';

/** `POST /v1/skills/:slug/run` response for a plain, single-variant run. */
export interface SkillSingleSubmitResult {
  run_id?: string;
  skill_run_id?: string;
  workflow_id?: string;
  skill: string;
  primitive?: string;
  status: string;
}

/**
 * One variant's outcome inside a make_ugc `variants` batch response
 * (routes/v1/skills.ts's buildBatchRunRecord). A dispatch failure carries
 * `error`/`detail` and no run id; a dispatch success carries the same
 * fields SkillSingleSubmitResult would for that variant's underlying
 * skill (composed → skill_run_id, primitive → run_id).
 */
export interface SkillBatchRunEntry {
  variant_index: number;
  http_status: number;
  run_id?: string;
  skill_run_id?: string;
  workflow_id?: string;
  skill?: string;
  primitive?: string;
  status?: string;
  error?: string;
  detail?: unknown;
}

/** `POST /v1/skills/make_ugc/run` response when the request set `variants`. */
export interface SkillBatchSubmitResult {
  batch: true;
  skill: string;
  total: number;
  succeeded: number;
  failed: number;
  runs: SkillBatchRunEntry[];
}
