// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for DELETE /v1/agent/chats/:id/messages/:clientMsgId —
 * real (soft) per-message delete. See agent-chats.ts's deleteMessageRoute.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; clientMsgId: string }> }) {
  const { id, clientMsgId } = await ctx.params;
  return forwardToAgentApi(`/v1/agent/chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(clientMsgId)}`, { method: 'DELETE' });
}
