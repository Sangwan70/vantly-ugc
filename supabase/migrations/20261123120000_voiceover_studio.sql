-- Voiceover Studio — edit a silent screen recording (Filmora / OBS capture),
-- cut/zoom/animate it, and voice it with ElevenLabs text-to-speech.
--
--   voiceover_projects   one editable project per uploaded recording; the whole
--                        editor state lives in `timeline` (validated by
--                        @vantly-ugc/schema VoiceoverTimelineSchema).
--   voiceover_tts_takes  ledger of every TTS generation (credits are debited
--                        against take.id so refunds/idempotency work with the
--                        existing deduct_credits / refund_credits RPCs).
--   user_provider_keys   a user's own provider API key (ElevenLabs today),
--                        AES-256-GCM encrypted by api-v2 — never stored or
--                        returned in plaintext.
--
-- Renders reuse primitive_runs / primitive_artifacts (primitive_id
-- 'voiceover_render'), so finished videos show up in Gallery and can be
-- published to social through the existing Vantly integration.
--
-- Forward-only, additive. No existing tables are altered. Service-role only
-- (RLS on, no policies) — like skill_drafts / primitive_runs, the web app only
-- reaches this data through api-v2's authenticated routes.

CREATE TABLE IF NOT EXISTS public.voiceover_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled voiceover',
  source jsonb,
  timeline jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_render_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voiceover_projects_user_updated
  ON public.voiceover_projects (user_id, updated_at DESC);

ALTER TABLE public.voiceover_projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voiceover_tts_takes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.voiceover_projects(id) ON DELETE SET NULL,
  block_id text NOT NULL,
  provider text NOT NULL DEFAULT 'elevenlabs',
  key_source text NOT NULL CHECK (key_source IN ('platform', 'user')),
  voice_id text NOT NULL,
  model_id text NOT NULL,
  chars integer NOT NULL,
  credits_deducted integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('submitted', 'succeeded', 'failed')),
  audio_url text,
  audio_duration numeric(10, 3),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voiceover_tts_takes_user_created
  ON public.voiceover_tts_takes (user_id, created_at DESC);

ALTER TABLE public.voiceover_tts_takes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_provider_keys (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('elevenlabs')),
  ciphertext text NOT NULL,
  last4 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.user_provider_keys ENABLE ROW LEVEL SECURITY;
