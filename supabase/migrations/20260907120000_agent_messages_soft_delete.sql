-- Real per-message delete on /dashboard/agent (task: "I need a real 'Delete'
-- option to delete any past message/generation").
--
-- Soft delete, matching the existing agent_chats/agent_projects convention
-- (see 20260626120000_agent_chats.sql's DELETE policies + agent-chats.ts's
-- "never hard delete — preserves skill_run audit links" comment on
-- deleteChatRoute): a deleted message's row — and its skill_run_id/
-- primitive_run_id linkage — stays in the table for audit/credit-reconciliation
-- purposes, it's just excluded from GET /v1/agent/chats/:id going forward.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- getChatRoute's message query filters WHERE deleted_at IS NULL; index that.
CREATE INDEX IF NOT EXISTS idx_agent_messages_chat_active
  ON public.agent_messages (chat_id, seq)
  WHERE deleted_at IS NULL;
