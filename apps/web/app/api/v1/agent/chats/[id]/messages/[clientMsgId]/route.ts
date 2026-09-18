// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Same-origin proxy for DELETE + PATCH /v1/agent/chats/:id/messages/:clientMsgId
 * — real (soft) per-message delete (deleteMessageRoute), and linking a run id
 * onto an already-persisted message after the fact (linkMessageRunRoute) —
 * see agent-chats.ts for both.
 */

import { NextRequest } from 'next/server';
import { forwardToAgentApi } from '@/lib/agent-chat-proxy';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; clientMsgId: string }> }) {
  const { id, clientMsgId } = await ctx.params;
  return forwardToAgentApi(`/v1/agent/chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(clientMsgId)}`, { method: 'DELETE' });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; clientMsgId: string }> }) {
  const { id, clientMsgId } = await ctx.params;
  const body = await req.text();
  return forwardToAgentApi(`/v1/agent/chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(clientMsgId)}`, { method: 'PATCH', body });
}
