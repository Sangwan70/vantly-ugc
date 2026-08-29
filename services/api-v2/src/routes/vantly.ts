// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Postiz integration routes.
 *
 *   GET  /v1/integrations/vantly/accounts
 *     Lists the user's connected social accounts on our self-hosted Vantly
 *     instance (a Postiz-based deployment at https://vantly.social — not
 *     the commercial platform.postiz.com/api.postiz.com).
 *     Reads the user's profiles.vantly_api_key — set either by pasting a
 *     Vantly org API key directly, or via the "Connect with Vantly" OAuth
 *     flow (apps/web/app/api/integrations/postiz/oauth/* — kept at this
 *     path since it's the OAuth App's registered redirect URL on
 *     vantly.social) — and lists
 *     integrations through the shared client in lib/vantly.ts. We never
 *     return the API key/token itself to the client.
 *
 *   POST /v1/integrations/vantly/test
 *     Fires a synthetic publish to verify the user's API key + chosen
 *     integration. No video generation involved — uses a placeholder
 *     1x1 PNG hosted on vantly-ugc. (Useful as the "Test connection"
 *     button on /settings.)
 *
 * The actual auto-publish on job.completed lives in the
 * webhook-provider edge function (no api-v2 involvement at fire time).
 */

import type { Request, Response } from 'express';
import { supabase } from '../server.js';
import { listIntegrations } from '../lib/vantly.js';

export async function vantlyListAccountsRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as unknown as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } });
    return;
  }

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('vantly_api_key, vantly_auth_method, vantly_default_integrations')
    .eq('id', userId)
    .maybeSingle();
  if (pErr) {
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Could not load profile' } });
    return;
  }
  const apiKey = (profile?.vantly_api_key as string | null) ?? null;
  if (!apiKey) {
    res.status(200).json({
      configured: false,
      auth_method: null,
      integrations: [],
      default_integrations: [],
    });
    return;
  }

  try {
    const integrations = await listIntegrations(apiKey);
    const safe = integrations.map((i) => ({
      id: i.id,
      name: i.name,
      identifier: i.identifier,
      picture: i.picture,
      disabled: i.disabled,
      profile: i.profile,
    }));
    res.status(200).json({
      configured: true,
      auth_method: (profile?.vantly_auth_method as string | null) ?? 'api_key',
      integrations: safe,
      default_integrations: (profile?.vantly_default_integrations as string[] | null) ?? [],
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    const message = err instanceof Error ? err.message : 'Vantly request failed';
    res.status(status === 401 || status === 403 ? 400 : 502).json({
      error: {
        code: status === 401 || status === 403 ? 'VANTLY_AUTH_FAILED' : 'VANTLY_UPSTREAM',
        message,
      },
    });
  }
}
