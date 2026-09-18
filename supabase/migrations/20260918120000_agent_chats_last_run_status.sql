-- Track the outcome of a chat's most recent generation directly on the chat
-- row (Milestone: chat cleanup UX -- "failed generations are unnecessarily
-- annoying, cluttering the list").
--
-- agent_chats.last_skill_run_id already gives O(1) "is a render live?" but
-- not O(1) "did it fail?" -- answering that today means joining out to
-- skill_runs (or, worse, parsing every chat's tool_result JSON) just to
-- decide sort order or which chats a "clear failed" bulk action should
-- touch. This is that answer, denormalized onto the chat row the same way
-- last_skill_run_id already is, and updated from the exact same places:
-- appendMessagesToChat, whenever a batch includes a tool_result whose
-- content has a real terminal status.
--
-- Additive, nullable, no backfill -- a chat created before this migration
-- just has last_run_status = NULL (treated as "not failed" by the sort/
-- cleanup logic, so old chats keep behaving exactly as before).
ALTER TABLE public.agent_chats
  ADD COLUMN IF NOT EXISTS last_run_status text
    CHECK (last_run_status IN ('succeeded', 'failed') OR last_run_status IS NULL);

-- Sort/filter index: rail sort is (pinned, failed-last, last_message_at);
-- "clear failed" scans exactly this shape.
CREATE INDEX IF NOT EXISTS idx_agent_chats_run_status
  ON public.agent_chats (user_id, last_run_status, last_message_at DESC)
  WHERE archived_at IS NULL;
