// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for GET /v1/social/publications/:id/resolve-url —
 * resolves a published row's platform permalink, if Postiz has one yet.
 * Polled a handful of times by the Social tab after a channel reaches
 * 'published' (see dashboard/social/page.tsx) — this proxy route was
 * missing entirely (the backend route existed, nothing served the path
 * on the frontend), so every poll silently 404'd and a published post's
 * permalink never showed up.
 */

import { NextRequest } from 'next/server';
import { proxy } from '../../../_proxy';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxy('GET', `/v1/social/publications/${encodeURIComponent(id)}/resolve-url`);
}
