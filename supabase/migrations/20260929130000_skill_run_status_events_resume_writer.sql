-- Add 'resume' to skill_run_status_events.writer's allowed values.
--
-- POST /v1/skills/runs/:id/resume (services/api-v2/src/routes/v1/skills.ts)
-- resets a FAILED skill_runs row back to 'submitted' so the SAME Temporal
-- workflow can be restarted under the SAME skill_run_id (see RESUMABLE_SKILLS
-- / resumeSkillRunRoute) -- a genuinely new writer, distinct from 'cancel'
-- (which only ever moves a row TOWARD a terminal state, never away from
-- one), so it needs its own audit-log identity rather than borrowing one
-- that means something different.

ALTER TABLE public.skill_run_status_events DROP CONSTRAINT IF EXISTS skill_run_status_events_writer_check;
ALTER TABLE public.skill_run_status_events
  ADD CONSTRAINT skill_run_status_events_writer_check
  CHECK (writer IN ('worker_activity', 'dispatch_failure', 'cancel', 'reconciler', 'resume'));
