-- Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

-- My Prompts: reusable make_ugc presets a user builds once on the guided
-- Gallery > My Prompts tab and reuses later — from that same tab (to keep
-- refining it) or from the "+" menu on /dashboard/agent, which lists these
-- by name and drops the selected one into the chat composer as a normal
-- message for the agent to act on. This tab creates and edits prompts; it
-- does not run them (make_ugc itself is only ever invoked through the
-- agent chat's own tool-use flow, same as everything else the agent does).
--
-- Every column mirrors one field of MakeUgcSkillInputSchema (or the
-- "Person" resolution the wizard performs client-side to pick exactly one
-- of person/character/image) plus a user-facing `name` to tell prompts
-- apart in the picker. Mirrors the shape of user_media.

CREATE TABLE IF NOT EXISTS public.user_prompts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),

  -- Helper-only "I want to generate…" one-liner used to (re-)draft the
  -- script via POST /v1/assist/draft-script; never sent to make_ugc itself.
  pitch          text,

  -- make_ugc's `script` — always required, always editable.
  script         text NOT NULL CHECK (char_length(script) BETWEEN 1 AND 1200),

  -- "Person" — resolves to exactly one of make_ugc's person/character/image
  -- at use time, matching the wizard's own mutually-exclusive UI modes.
  person_mode       text NOT NULL DEFAULT 'describe'
                     CHECK (person_mode IN ('describe', 'my-character', 'stock-actor', 'upload')),
  person_text       text,  -- describe mode: free-text -> `person`
  person_ref_id     text,  -- my-character/stock-actor: source id, for re-selecting in the UI
  person_ref_name   text,  -- my-character/stock-actor: display name
  person_image_url  text,  -- my-character (-> `character`) / stock-actor / upload (-> `image`): a URL

  look           text NOT NULL DEFAULT 'natural'
                 CHECK (look IN ('natural', 'commercial', 'raw_iphone')),
  aspect_ratio   text NOT NULL DEFAULT '9:16'
                 CHECK (aspect_ratio IN ('9:16', '1:1')),

  -- Advanced (all optional, map to make_ugc's own optional fields)
  name_hint      text,
  captions       boolean NOT NULL DEFAULT false,
  caption_style  text NOT NULL DEFAULT 'hormozi'
                 CHECK (caption_style IN ('hormozi', 'tiktok', 'minimal')),
  music          boolean NOT NULL DEFAULT false,
  music_text     text,
  broll_url      text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_prompts_user_id_created_at_idx
  ON public.user_prompts (user_id, created_at DESC);

CREATE TRIGGER trg_user_prompts_updated
  BEFORE UPDATE ON public.user_prompts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prompts_owner_select ON public.user_prompts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_prompts_owner_insert ON public.user_prompts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_prompts_owner_update ON public.user_prompts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_prompts_owner_delete ON public.user_prompts
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY user_prompts_service_all ON public.user_prompts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
