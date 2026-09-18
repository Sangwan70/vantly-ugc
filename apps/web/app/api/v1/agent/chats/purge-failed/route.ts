// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for /v1/agent/chats/purge-failed — the "Clear failed
 * generations" bulk action. Hard-deletes every one of the caller's own
 * chats whose last generation failed (and isn't pinned), along with the
 * R2 media and skill_runs/primitive_runs rows those failed generations
 * left behind. Irreversible — see purgeFailedAgentChatsRoute in
 * services/api-v2/src/routes/v1/agent-chats.ts for exactly what it touches.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function POST(_req: NextRequest) {
  return forwardToAgentApi('/v1/agent/chats/purge-failed', { method: 'POST' });
}
