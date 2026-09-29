-- skill_drafts — autosaved, unsubmitted form state per (user, skill).
--
-- Closes the gap where a user's typed inputs (guest description, discussion
-- topic, an AI-drafted dialogue script, etc.) only ever lived in transient
-- browser state until the FIRST successful POST to /v1/skills/:slug/run --
-- any error before that point (a network blip, a client-orchestrated
-- pre-step like make_portrait failing, a page refresh) silently discarded
-- everything the user had typed or generated so far, forcing a full restart.
--
-- One row per (user_id, skill_slug): the dashboard's RunPanel autosaves the
-- in-progress form here (debounced) and restores it on next visit; it is
-- deleted once the form is actually submitted (the data becomes durable in
-- skill_runs.input at that point, so the draft is redundant).
--
-- Forward-only, additive. No existing tables are altered.

CREATE TABLE IF NOT EXISTS public.skill_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  form_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_skill_drafts_user_skill
  ON public.skill_drafts (user_id, skill_slug);

-- Service-role only (mirrors skill_runs / primitive_runs): the web app never
-- talks to Supabase directly for this data, only through api-v2's own
-- authenticated routes.
ALTER TABLE public.skill_drafts ENABLE ROW LEVEL SECURITY;
