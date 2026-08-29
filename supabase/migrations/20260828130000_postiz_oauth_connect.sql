-- Postiz/Vantly OAuth connect — adds an OAuth path alongside the existing
-- manually-pasted API key (see 20260510140000_postiz_publish.sql). Both
-- paths write the same raw token into profiles.postiz_api_key and are used
-- identically downstream (services/api-v2/src/lib/postiz.ts); these columns
-- just track *how* it got there, for the settings-page UI and support.
--
-- NOTE: this is unrelated to the older profiles.postiz_id column (Postiz
-- SSO login, added by 20260308000001_add_postiz_id_to_profiles.sql). That
-- old platform.postiz.com login flow was retired, but "Sign in with Vantly"
-- (apps/web/app/api/auth/vantly/route.ts + the shared
-- .../integrations/postiz/oauth/callback/route.ts) revived this column: it
-- now stores the Vantly organizationId a login-SSO account is keyed to
-- (Vantly's OAuth token has no per-person identity, only an org id — see
-- that callback's comments). Do not drop this column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS postiz_auth_method text NOT NULL DEFAULT 'api_key',
  ADD COLUMN IF NOT EXISTS postiz_oauth_org_id text,
  ADD COLUMN IF NOT EXISTS postiz_oauth_connected_at timestamptz;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_postiz_auth_method_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_postiz_auth_method_check
  CHECK (postiz_auth_method IN ('api_key', 'oauth'));

COMMENT ON COLUMN public.profiles.postiz_auth_method IS
  'How postiz_api_key was obtained: ''api_key'' (user pasted it manually) or ''oauth'' (via Connect with Vantly). Both are used identically as the raw Authorization header value.';
COMMENT ON COLUMN public.profiles.postiz_oauth_org_id IS
  'Vantly organization id returned by the OAuth token exchange, when postiz_auth_method = ''oauth''. Display/debug only.';
COMMENT ON COLUMN public.profiles.postiz_oauth_connected_at IS
  'When the current OAuth connection was established. NULL for the manual API-key path.';
