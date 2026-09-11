// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /v1/models
 *
 * Read-only view of the model catalog (@vantly-ugc/schema/v2 V2_MODELS) —
 * the same data the `list_models` MCP tool and the loose-surface
 * generate_image/video/audio tools read. By default only `status:
 * 'live'` models are returned (the ones actually selectable); pass
 * ?all=true to also see `candidate` models (in the plan, not yet
 * selectable — see the catalog's own doc comment for what that means).
 *
 * No credits, no auth required beyond the normal API key check already
 * applied by the router this is mounted under — this is pure metadata.
 */

import type { Request, Response } from 'express';
import { V2_MODELS, V2_DEFAULT_MODEL, AUTO_MIN_SCORED, AUTO_MIN_GAIN, AUTO_MAX_PRICE_RATIO, AUTO_MAX_FAIL_RATE } from '@vantly-ugc/schema/v2';

const AUTO_POLICY_TEXT =
  `model:"auto" starts from the kind's default (image: ${V2_DEFAULT_MODEL.image}, video: ${V2_DEFAULT_MODEL.video}, audio: ${V2_DEFAULT_MODEL.audio}); ` +
  `switches only when the default failed >${Math.round(AUTO_MAX_FAIL_RATE * 100)}% of >=${AUTO_MIN_SCORED} runs and another live model is healthy, ` +
  `or when a live model within ${AUTO_MAX_PRICE_RATIO}x the default's price beats its auto score by >=${AUTO_MIN_GAIN} over >=${AUTO_MIN_SCORED} judged runs. ` +
  `Note: this repo does not yet record judged runs (no rate_run / auto-judge pipeline — a separate, larger upstream feature not yet ported), ` +
  `so today "auto" always resolves to the kind's default.`;

export function listModelsRoute(req: Request, res: Response): void {
  const includeAll = req.query.all === 'true' || req.query.all === '1';
  const models = Object.values(V2_MODELS).filter((m) => includeAll || m.status === 'live');
  res.status(200).json({
    models,
    defaults: V2_DEFAULT_MODEL,
    auto_policy: AUTO_POLICY_TEXT,
  });
}
