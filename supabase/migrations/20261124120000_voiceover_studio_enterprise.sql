-- Voiceover Studio — enterprise features.
--
--   studio_workspaces / _members / _invites   teams with roles (owner, admin, editor, reviewer, viewer)
--   workspace_provider_keys                   one shared ElevenLabs account per team (AES-GCM, api-v2)
--   voiceover_projects (+ columns)            workspace, review status, smart-edit analysis, proxy
--                                             status, language/localization parent, series, template,
--                                             data region, automation config
--   voiceover_comments                        timestamped review comments
--   voiceover_audit                           audit log of every sensitive action
--   voiceover_templates                       reusable look / voice / intro-outro presets
--   voice_consents                            consent records for cloned voices
--   voiceover_pron_dicts                      cache of ElevenLabs pronunciation dictionaries
--   voiceover_uploads                         direct-to-storage multipart uploads
--
-- Forward-only and additive. Service-role only (RLS on, no policies): the web
-- app reaches all of this through api-v2, which enforces workspace roles.

CREATE TABLE IF NOT EXISTS public.studio_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.studio_workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.studio_workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_studio_members_user ON public.studio_workspace_members (user_id);
ALTER TABLE public.studio_workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.studio_workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'reviewer', 'viewer')),
  token text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_studio_invites_email ON public.studio_workspace_invites (lower(email)) WHERE accepted_at IS NULL;
ALTER TABLE public.studio_workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspace_provider_keys (
  workspace_id uuid NOT NULL REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('elevenlabs')),
  ciphertext text NOT NULL,
  last4 text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);
ALTER TABLE public.workspace_provider_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.voiceover_projects
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.studio_workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS analysis jsonb,
  ADD COLUMN IF NOT EXISTS prepare_status text NOT NULL DEFAULT 'pending' CHECK (prepare_status IN ('pending', 'running', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'in_review', 'changes_requested', 'approved')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS source_project_id uuid REFERENCES public.voiceover_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_region text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS automation jsonb;
CREATE INDEX IF NOT EXISTS idx_voiceover_projects_workspace ON public.voiceover_projects (workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voiceover_projects_series ON public.voiceover_projects (user_id, series) WHERE series IS NOT NULL;

ALTER TABLE public.voiceover_tts_takes
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.studio_workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.voiceover_tts_takes DROP CONSTRAINT IF EXISTS voiceover_tts_takes_key_source_check;
ALTER TABLE public.voiceover_tts_takes ADD CONSTRAINT voiceover_tts_takes_key_source_check CHECK (key_source IN ('platform', 'user', 'workspace'));
CREATE INDEX IF NOT EXISTS idx_voiceover_takes_workspace ON public.voiceover_tts_takes (workspace_id, created_at) WHERE workspace_id IS NOT NULL;

-- Render runs are attributed to a workspace through input.provenance.workspace_id.
CREATE INDEX IF NOT EXISTS idx_primitive_runs_voiceover_workspace
  ON public.primitive_runs ((input -> 'provenance' ->> 'workspace_id'), created_at)
  WHERE primitive_id = 'voiceover_render';

CREATE TABLE IF NOT EXISTS public.voiceover_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.voiceover_projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email text,
  t numeric(10, 3),
  body text NOT NULL,
  parent_id uuid REFERENCES public.voiceover_comments(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'submit', 'approve', 'request_changes', 'reopen')),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voiceover_comments_project ON public.voiceover_comments (project_id, created_at);
ALTER TABLE public.voiceover_comments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voiceover_audit (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  project_id uuid,
  user_id uuid,
  user_email text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voiceover_audit_workspace ON public.voiceover_audit (workspace_id, created_at DESC);
ALTER TABLE public.voiceover_audit ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voiceover_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  template jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voiceover_templates_owner ON public.voiceover_templates (user_id) WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_voiceover_templates_workspace ON public.voiceover_templates (workspace_id) WHERE workspace_id IS NOT NULL;
ALTER TABLE public.voiceover_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voice_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.studio_workspaces(id) ON DELETE CASCADE,
  voice_id text NOT NULL,
  voice_name text NOT NULL DEFAULT '',
  voice_source text NOT NULL CHECK (voice_source IN ('user', 'workspace')),
  speaker_name text NOT NULL,
  statement text NOT NULL,
  evidence_url text,
  attested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attested_by_email text,
  attested_ip text,
  attested_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_voice_consents_voice ON public.voice_consents (voice_id) WHERE revoked_at IS NULL;
ALTER TABLE public.voice_consents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voiceover_pron_dicts (
  key_fingerprint text NOT NULL,
  rules_hash text NOT NULL,
  dictionary_id text NOT NULL,
  version_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_fingerprint, rules_hash)
);
ALTER TABLE public.voiceover_pron_dicts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.voiceover_uploads (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  region text NOT NULL DEFAULT 'default',
  key text NOT NULL,
  upload_id text NOT NULL,
  bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_voiceover_uploads_user ON public.voiceover_uploads (user_id, created_at DESC);
ALTER TABLE public.voiceover_uploads ENABLE ROW LEVEL SECURITY;
