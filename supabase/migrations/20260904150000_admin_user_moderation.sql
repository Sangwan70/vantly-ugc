-- Admin user moderation: block/suspend + hard-delete support.
--
-- Two independent pieces:
--
-- 1) profiles.is_blocked/blocked_at/blocked_reason -- lets an admin suspend
--    a user's access without touching their data. Enforcement happens in
--    application code (apps/web/app/api/admin/block-user/route.ts bans the
--    user via Supabase's own auth.admin.updateUserById ban_duration, which
--    is what actually stops them logging in -- this column alone is just
--    the admin-UI-visible record of that state, mirrored so the admin list
--    doesn't need a second round-trip to auth admin APIs to show it).
--
-- 2) FK cascade fix on generation_jobs.user_id and credit_transactions.user_id
--    (plus the rarely-populated device_codes.user_id). Both were created
--    referencing public.profiles(id) with NO ON DELETE action -- Postgres
--    defaults that to NO ACTION, which means deleting a user via
--    admin.auth.admin.deleteUser() (which cascades auth.users -> profiles)
--    would fail with a foreign-key violation for any user who has ever
--    generated anything or had a credit transaction -- i.e. almost every
--    real user. Ram's explicit choice (2026-09-04): make delete-user a true
--    hard delete -- wipe the user's jobs and credit-transaction ledger
--    along with their account, no retained trace. This trades away
--    post-delete financial/audit history for a real "delete this user"
--    button; block-user (above) is the alternative when history needs to
--    be kept and access merely suspended.
--
-- subscriptions.user_id and user_credits.user_id already had ON DELETE
-- CASCADE from their original migrations and needed no change.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_blocked     boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS blocked_at     timestamptz,
    ADD COLUMN IF NOT EXISTS blocked_reason text;

COMMENT ON COLUMN public.profiles.is_blocked
    IS 'Admin-set suspension flag. The actual login block is enforced via Supabase auth (updateUserById ban_duration) in block-user/route.ts -- this column mirrors that state for the admin UI, it does not itself gate access.';

CREATE INDEX IF NOT EXISTS idx_profiles_is_blocked
    ON public.profiles(is_blocked) WHERE is_blocked = true;

-- generation_jobs.user_id: NO ACTION -> CASCADE.
ALTER TABLE public.generation_jobs
    DROP CONSTRAINT IF EXISTS generation_jobs_user_id_fkey;
ALTER TABLE public.generation_jobs
    ADD CONSTRAINT generation_jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- credit_transactions.user_id: NO ACTION -> CASCADE. This is the app's
-- credit/billing ledger -- deleting a user now deletes their transaction
-- history along with them, per the explicit product decision above.
ALTER TABLE public.credit_transactions
    DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey;
ALTER TABLE public.credit_transactions
    ADD CONSTRAINT credit_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- device_codes.user_id: nullable, NO ACTION -> CASCADE (rarely populated by
-- the time a user is deleted, but would otherwise block delete just the
-- same as the two tables above).
ALTER TABLE public.device_codes
    DROP CONSTRAINT IF EXISTS device_codes_user_id_fkey;
ALTER TABLE public.device_codes
    ADD CONSTRAINT device_codes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Minimal audit trail for destructive admin actions on user accounts.
-- Deliberately NOT foreign-keyed to profiles/auth.users: a delete row must
-- survive the very deletion it's recording, so target_user_id is a plain
-- uuid column, not a reference.
CREATE TABLE IF NOT EXISTS public.admin_actions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_email     text        NOT NULL,
    action          text        NOT NULL CHECK (action IN ('delete_user', 'block_user', 'unblock_user', 'downgrade_to_free')),
    target_user_id  uuid        NOT NULL,
    target_email    text,
    details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_actions
    IS 'Audit log for destructive/moderation admin actions (delete-user, block-user, downgrade-to-free). No FK to profiles/auth.users by design -- a delete_user row must remain readable after the user it describes is gone.';

CREATE INDEX IF NOT EXISTS idx_admin_actions_target
    ON public.admin_actions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
    ON public.admin_actions(created_at DESC);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_actions_service_all ON public.admin_actions;
CREATE POLICY admin_actions_service_all ON public.admin_actions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
