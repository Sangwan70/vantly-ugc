// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared Sentry alerting for api-v2's direct-HTTP AI routes (Reliability
 * Coverage Spec — Milestone 1, item 6).
 *
 * Every route that calls the model provider synchronously and answers the
 * HTTP request itself (as opposed to generate.ts's job-dispatch routes,
 * which already get an alert from the async reconciler's
 * WORKER_DISPATCH_FAILED capture) previously failed silently from an
 * observability standpoint: the user got a JSON error, but nothing showed
 * up in Sentry, so a spike in Anthropic 5xxs/timeouts was invisible until
 * someone complained.
 *
 * Policy: capture once per REQUEST, at the point a route gives up and
 * sends its failure response — never inside the shared
 * `callAnthropicMessages()` client itself. Two of the six call sites
 * (agent.ts, assist.ts) already retry once (agent.ts: same model;
 * assist.ts: primary then a fallback model) before failing, so capturing
 * there means "capture only after the retry ALSO failed," not on every
 * transient blip — the retry is what actually recovers those, and
 * alerting on every recovered attempt would just be noise. The other
 * four (blog-assist.ts, character-storyboard.ts, schedule-preview.ts,
 * generate.ts's two script-generation call sites) make a single attempt,
 * so their one catch block already IS the final failure point.
 */

import * as Sentry from '@sentry/node';

export function captureAiRouteFailure(
  route: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
    tags: { kind: 'ai_route_failure', route },
    extra,
  });
}
