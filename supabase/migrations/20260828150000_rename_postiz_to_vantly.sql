-- Renames the Postiz-era column/table/index/policy names to Vantly, now
-- that agent-media-app talks exclusively to vantly.social (see
-- 20260828130000_postiz_oauth_connect.sql and the api-v2 / apps/web code
-- that was migrated alongside this). RENAME preserves all existing data —
-- it only changes catalog names — but indexes, check constraints, and RLS
-- policies each need an explicit rename too since Postgres does not cascade
-- those automatically the way it does for foreign keys and views.

-- ── profiles columns ─────────────────────────────────────────────────────
ALTER TABLE public.profiles RENAME COLUMN postiz_api_key TO vantly_api_key;
ALTER TABLE public.profiles RENAME COLUMN postiz_default_integrations TO vantly_default_integrations;
ALTER TABLE public.profiles RENAME COLUMN postiz_auth_method TO vantly_auth_method;
ALTER TABLE public.profiles RENAME COLUMN postiz_oauth_org_id TO vantly_oauth_org_id;
ALTER TABLE public.profiles RENAME COLUMN postiz_oauth_connected_at TO vantly_oauth_connected_at;

-- postiz_id predates the OAuth work (added by
-- 20260308000001_add_postiz_id_to_profiles.sql for the old
-- platform.postiz.com SSO login) and is now used by "Sign in with Vantly"
-- (apps/web/app/api/auth/vantly/route.ts) to key a login-SSO account to the
-- Vantly organizationId that authorized it — vantly_org_id describes that
-- accurately, whereas the old name no longer means anything on its own.
ALTER TABLE public.profiles RENAME COLUMN postiz_id TO vantly_org_id;

ALTER INDEX IF EXISTS public.idx_profiles_postiz_id RENAME TO idx_profiles_vantly_org_id;

ALTER TABLE public.profiles RENAME CONSTRAINT profiles_postiz_auth_method_check TO profiles_vantly_auth_method_check;

-- ── postiz_publications table ────────────────────────────────────────────
ALTER TABLE public.postiz_publications RENAME TO vantly_publications;
ALTER TABLE public.vantly_publications RENAME COLUMN postiz_post_id TO vantly_post_id;
ALTER TABLE public.vantly_publications RENAME COLUMN postiz_upload_id TO vantly_upload_id;
ALTER TABLE public.vantly_publications RENAME COLUMN postiz_upload_path TO vantly_upload_path;

ALTER INDEX IF EXISTS public.idx_postiz_publications_user_id RENAME TO idx_vantly_publications_user_id;
ALTER INDEX IF EXISTS public.idx_postiz_publications_job_id RENAME TO idx_vantly_publications_job_id;

ALTER POLICY postiz_publications_select_own ON public.vantly_publications RENAME TO vantly_publications_select_own;
ALTER POLICY postiz_publications_no_user_write ON public.vantly_publications RENAME TO vantly_publications_no_user_write;

-- NOTE: public.postiz_users (added by 20260530170000_postiz_users.sql, for
-- the retired Postiz-Enterprise auto-provisioning flow) is left untouched.
-- Nothing in the codebase reads or writes it any more — it's genuinely
-- dead, not just renamed-away — so it's a separate cleanup (a DROP TABLE
-- migration) whenever you're confident no data in it is still needed.
