// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * HTTP dispatch helper for the legacy `engine === 'http'` selfie path.
 *
 * Extracted from `selfie.ts` so the dispatch contract (await, timeout,
 * non-2xx → throw) can be exercised by tests against a real local HTTP
 * server without mocking. Mirrors the Temporal activity contract in
 * `orchestrator/temporal/activities.ts`.
 *
 * Throws on any non-2xx, network error, or timeout — callers MUST treat
 * a thrown error as a dispatch failure and mark the job failed + refund.
 */

import type { SelfieDispatchPayload } from '../../orchestrator/temporal/types.js';

const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;

/** Loose-surface generate_image / generate_video / generate_audio dispatch payload — see generate.ts. */
export type GenerateDispatchPayload = Record<string, unknown> & { job_id: string; user_id: string; callback_url: string };

export async function dispatchSelfieToHttpWorker(
  workerV2Url: string,
  workerSecret: string,
  payload: SelfieDispatchPayload,
  timeoutMs: number = DEFAULT_DISPATCH_TIMEOUT_MS,
): Promise<void> {
  const resp = await fetch(`${workerV2Url}/v2/selfie`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': workerSecret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `media-worker-v2 dispatch failed (${resp.status}): ${body.slice(0, 500)}`,
    );
  }
}

/**
 * HTTP dispatch for the loose surface (generate_image / generate_video /
 * generate_audio). Same contract as dispatchSelfieToHttpWorker: throws on
 * any non-2xx, network error, or timeout — the caller marks the job
 * failed + refunds.
 *
 * Only the `engine === 'http'` path is wired for the loose surface today;
 * there is no Temporal workflow for generate-image/video/audio yet (see
 * the upstream-comparison report — this can be added later the same way
 * selfie/crazy-look already were, without changing this function).
 */
export async function dispatchGenerateToHttpWorker(
  workerV2Url: string,
  workerSecret: string,
  kind: 'image' | 'video' | 'audio',
  payload: GenerateDispatchPayload,
  timeoutMs: number = DEFAULT_DISPATCH_TIMEOUT_MS,
): Promise<void> {
  const resp = await fetch(`${workerV2Url}/v2/generate/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': workerSecret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `media-worker-v2 generate dispatch failed (${resp.status}): ${body.slice(0, 500)}`,
    );
  }
}

/**
 * Ask the worker to measure how long each of these https media URLs runs
 * (video_refs seconds), so the loose-surface video quote can bill them at
 * submit. Best-effort: a worker that is unreachable returns an empty map
 * rather than failing the quote.
 */
export async function probeMediaDurations(
  workerV2Url: string,
  workerSecret: string,
  urls: string[],
  timeoutMs: number = DEFAULT_DISPATCH_TIMEOUT_MS,
): Promise<Record<string, number | null>> {
  if (!urls.length) return {};
  try {
    const resp = await fetch(`${workerV2Url}/v2/probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
      },
      body: JSON.stringify({ urls }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return {};
    const data = (await resp.json()) as { durations?: Record<string, number | null> };
    return data.durations ?? {};
  } catch {
    return {};
  }
}
