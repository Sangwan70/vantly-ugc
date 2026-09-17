-- Durable audit log for skill_runs.status writes (Milestone 1, item 1).
--
-- Three independent code paths write skill_runs.status, each with its own
-- ad-hoc guard reasoning and no visibility into what the others did:
--   - primitive-worker-vnext/src/activities/composed-state.ts (per-step
--     progress; guards against resurrecting a terminal row, see d8f7d46)
--   - api-v2/src/routes/v1/skills.ts markSkillRunDispatchFailed
--     (workflow.start() throws in the dispatch route's catch block)
--   - api-v2/src/routes/v1/skills.ts cancel handler (~line 1389)
--   - api-v2/src/orchestrator/skill-reconciler.ts (stuck-run sweep)
--
-- d8f7d46 root-caused and fixed the one specific race reported against run
-- 4ca002c6 (a resurrected workflow silently stomping an already-'failed'
-- row back to 'running'). This table is not a second fix for that bug --
-- it's the general trail the original audit asked for, so the *next*
-- disagreement between the two run-status UI surfaces is a query against
-- this table instead of another live HAR-file investigation.
--
-- Append-only, forward-only, additive. It never gates a write -- it only
-- records one after the fact -- so it can't introduce a new race into a
-- system whose races are exactly what it exists to diagnose.

CREATE TABLE IF NOT EXISTS public.skill_run_status_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_run_id     uuid NOT NULL REFERENCES public.skill_runs(id) ON DELETE CASCADE,
  writer           text NOT NULL CHECK (writer IN ('worker_activity', 'dispatch_failure', 'cancel', 'reconciler')),
  from_status      text,
  to_status        text NOT NULL,
  applied          boolean NOT NULL,
  current_step     text,
  error_code       text,
  workflow_run_id  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_run_status_events_run
  ON public.skill_run_status_events (skill_run_id, created_at);

ALTER TABLE public.skill_run_status_events ENABLE ROW LEVEL SECURITY;

-- Owner can read the history of their own runs (join through skill_runs,
-- mirroring every other vNext table's owner-read policy shape).
DROP POLICY IF EXISTS skill_run_status_events_owner_select ON public.skill_run_status_events;
CREATE POLICY skill_run_status_events_owner_select ON public.skill_run_status_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.skill_runs sr
      WHERE sr.id = skill_run_status_events.skill_run_id
        AND sr.user_id = auth.uid()
    )
  );

-- Only the service-role writers (worker + api-v2) insert; nobody updates or
-- deletes an event -- the log is append-only by construction, not just by
-- convention.
DROP POLICY IF EXISTS skill_run_status_events_service_insert ON public.skill_run_status_events;
CREATE POLICY skill_run_status_events_service_insert ON public.skill_run_status_events
  FOR INSERT TO service_role WITH CHECK (true);
