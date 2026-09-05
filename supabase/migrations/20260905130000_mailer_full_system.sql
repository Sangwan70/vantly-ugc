-- Mailer System: full feature build, replacing the deliberately scoped-
-- down v1 disclosed in 20260904180000_mailer_core.sql's own COMMENT ON
-- TABLE. Adds: multi-provider sending, unsubscribe/suppression
-- (compliance-critical), real per-recipient delivery/open/click
-- tracking, rule-based ("smart") group segmentation, Landing Pages,
-- automated lifecycle triggers, campaign scheduling + an expanded
-- lifecycle, coupon integration, and an admin audit log.
--
-- Deliberately EXCLUDED, per direct instruction: the AI/B2B List Builder
-- (AutoGPT's EmailB2BListRun/EmailB2BCandidate -- LLM-powered contact
-- discovery). Nothing in this migration adds that feature.

-- ─── mailer_config: multi-provider sending (was Resend-only) ─────────────
-- Same "nullable override, never echoed back to the browser" posture as
-- the existing resend_api_key column (see 20260904130000_admin_settings.sql).
-- `provider` selects which of these credential sets getEffectiveSenderConfig
-- (lib/mailer/sender-config.ts) actually uses; the others stay stored but
-- unused, so switching providers and back doesn't lose configuration.
ALTER TABLE public.mailer_config
    ADD COLUMN IF NOT EXISTS provider               text NOT NULL DEFAULT 'resend'
        CHECK (provider IN ('resend', 'postmark', 'ses', 'smtp')),
    ADD COLUMN IF NOT EXISTS postmark_api_key        text,
    ADD COLUMN IF NOT EXISTS ses_access_key_id       text,
    ADD COLUMN IF NOT EXISTS ses_secret_access_key   text,
    ADD COLUMN IF NOT EXISTS ses_region              text,
    ADD COLUMN IF NOT EXISTS smtp_host               text,
    ADD COLUMN IF NOT EXISTS smtp_port               integer,
    ADD COLUMN IF NOT EXISTS smtp_username           text,
    ADD COLUMN IF NOT EXISTS smtp_password           text,
    ADD COLUMN IF NOT EXISTS smtp_secure             boolean NOT NULL DEFAULT true;

-- ─── email_groups: rule-based ("smart") segmentation ─────────────────────
-- Adds a third group type alongside 'manual' (admin-curated list) and
-- 'all_users' (every signed-up user). A 'smart' group's members[] /
-- member_count stay unused (like all_users) -- membership is resolved
-- fresh at send/preview time by evaluating smart_rules against live user
-- data (lib/mailer/resolve-recipients.ts), the same "no stale snapshot"
-- reasoning the existing all_users type already documents. smart_rules
-- shape: {"match": "all"|"any", "conditions": [{"field": "plan_slug",
-- "op": "eq"|"in"|"gte"|"lte", "value": ...}, ...]}.
ALTER TABLE public.email_groups DROP CONSTRAINT IF EXISTS email_groups_type_check;
ALTER TABLE public.email_groups ADD CONSTRAINT email_groups_type_check
    CHECK (type IN ('manual', 'all_users', 'smart'));
ALTER TABLE public.email_groups ADD COLUMN IF NOT EXISTS smart_rules jsonb;

-- ─── email_campaigns: scheduling, expanded lifecycle, coupon feature ─────
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_status_check;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));
ALTER TABLE public.email_campaigns
    ADD COLUMN IF NOT EXISTS schedule_type text NOT NULL DEFAULT 'immediate'
        CHECK (schedule_type IN ('immediate', 'scheduled')),
    -- When schedule_type = 'scheduled', the send dispatcher (a pg_cron
    -- tick, see below) picks this campaign up once now() >= scheduled_at
    -- and status = 'scheduled'. NULL for immediate campaigns.
    ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
    -- Featured coupon this campaign promotes -- lets a template reference
    -- {{coupon_code}} and the campaign UI show/copy it, without a second
    -- copy of the coupon's own fields living on the campaign row. SET
    -- NULL (not RESTRICT) on coupon delete: a sent campaign's history
    -- shouldn't block deleting an expired coupon later.
    ADD COLUMN IF NOT EXISTS featured_coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled
    ON public.email_campaigns(scheduled_at) WHERE status = 'scheduled';

COMMENT ON TABLE public.email_campaigns IS
    'Full lifecycle: draft -> (scheduled ->) sending -> sent|failed, or cancelled from draft/scheduled. Per-recipient outcomes (sent/failed/opened/clicked) live in email_logs, not on this row -- total_sent/total_failed here are running counters updated as email_logs rows are written.';

-- ─── email_logs: real per-recipient delivery/open/click tracking ────────
-- One row per recipient per campaign, created when the send route queues
-- that recipient and updated as the provider reports outcomes (send
-- success/failure immediately; opens/clicks asynchronously via
-- tracking_token, see the tracking pixel/redirect routes). This is the
-- "per-member detail" this Mailer pass adds -- who actually got a given
-- campaign, not just an aggregate count.
CREATE TABLE IF NOT EXISTS public.email_logs (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         uuid        NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    recipient_email     text        NOT NULL,
    status              text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),
    error               text,
    provider            text,       -- which provider actually sent it (may differ from current mailer_config.provider for old campaigns)
    provider_message_id text,
    -- Unguessable per-recipient token embedded in this send's tracking
    -- pixel <img> src and link-redirect URLs -- lets /api/mailer/track/
    -- open and /api/mailer/track/click attribute an event back to this
    -- exact (campaign, recipient) pair without exposing the email address
    -- or a guessable sequential id in the URL. Built from two
    -- gen_random_uuid()s (a CSPRNG since PG13, already relied on for
    -- every id column in this schema) rather than pgcrypto's
    -- gen_random_bytes(), which isn't guaranteed enabled on this project
    -- -- avoids adding an extension dependency for one column.
    tracking_token      text        NOT NULL
        DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
    opened_at           timestamptz,
    open_count          integer     NOT NULL DEFAULT 0,
    first_clicked_at    timestamptz,
    click_count         integer     NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tracking_token)
);

CREATE INDEX IF NOT EXISTS idx_email_logs_campaign ON public.email_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON public.email_logs(recipient_email);

DROP TRIGGER IF EXISTS trg_email_logs_updated ON public.email_logs;
CREATE TRIGGER trg_email_logs_updated BEFORE UPDATE ON public.email_logs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_service_all ON public.email_logs;
CREATE POLICY email_logs_service_all ON public.email_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic open/click recorders -- called by the (unauthenticated, public)
-- tracking pixel and link-redirect routes, so they must not depend on
-- the caller being an admin. SECURITY DEFINER + service-role-only RLS
-- above means these two RPCs are the only way an anon/public caller can
-- touch email_logs at all.
CREATE OR REPLACE FUNCTION public.record_email_open(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.email_logs
       SET open_count = open_count + 1,
           opened_at = COALESCE(opened_at, now())
     WHERE tracking_token = p_token;
$$;

CREATE OR REPLACE FUNCTION public.record_email_click(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.email_logs
       SET click_count = click_count + 1,
           first_clicked_at = COALESCE(first_clicked_at, now())
     WHERE tracking_token = p_token;
$$;

-- ─── email_suppressions: unsubscribe + suppression list ──────────────────
-- The single highest-priority gap the Mailer audit found: zero mechanism
-- existed to stop emailing someone who unsubscribed, bounced, or
-- complained. Checked by resolve-recipients.ts before every send
-- (campaigns AND automated triggers) -- an email in this table is never
-- sent to, full stop, regardless of which group/list put it in the
-- candidate set.
CREATE TABLE IF NOT EXISTS public.email_suppressions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email               text        NOT NULL,
    reason              text        NOT NULL DEFAULT 'unsubscribed'
                                     CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual')),
    source_campaign_id  uuid        REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness -- "Foo@x.com" and "foo@x.com" are the same
-- suppression, and the send path must check case-insensitively too (see
-- resolve-recipients.ts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_email_lower
    ON public.email_suppressions (lower(email));

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppressions_service_all ON public.email_suppressions;
CREATE POLICY email_suppressions_service_all ON public.email_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Idempotent insert used by the public (unauthenticated) unsubscribe link
-- and by a provider bounce/complaint webhook -- ON CONFLICT DO NOTHING so
-- clicking an unsubscribe link twice, or a duplicate webhook delivery,
-- never errors.
CREATE OR REPLACE FUNCTION public.add_email_suppression(
    p_email       text,
    p_reason      text,
    p_campaign_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.email_suppressions (email, reason, source_campaign_id)
    VALUES (p_email, p_reason, p_campaign_id)
    ON CONFLICT (lower(email))
    -- A later, more specific reason (e.g. a bounce after a prior manual
    -- suppression) is worth recording; either way the email stays
    -- suppressed, which is the only property that actually matters.
    DO UPDATE SET reason = EXCLUDED.reason;
$$;

-- ─── email_landing_pages: public opt-in forms ────────────────────────────
-- Public GET /subscribe/[slug] renders title/description and a form;
-- POST appends the submitted email to target_group_id's members[] (a
-- 'manual' group) after a suppression check, same as any other send
-- path. No RLS policy for anon/authenticated -- the public route reads
-- via the service-role admin client (matching every other public-facing
-- content route in this app, e.g. lib/content/get-page.ts), not direct
-- client-side Supabase access.
CREATE TABLE IF NOT EXISTS public.email_landing_pages (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              text        NOT NULL UNIQUE,
    title             text        NOT NULL,
    description       text        NOT NULL DEFAULT '',
    target_group_id   uuid        NOT NULL REFERENCES public.email_groups(id) ON DELETE CASCADE,
    status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    success_message   text        NOT NULL DEFAULT 'Thanks -- you''re subscribed.',
    redirect_url      text,
    submit_count      integer     NOT NULL DEFAULT 0,
    created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_email_landing_pages_updated ON public.email_landing_pages;
CREATE TRIGGER trg_email_landing_pages_updated BEFORE UPDATE ON public.email_landing_pages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_landing_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_landing_pages_service_all ON public.email_landing_pages;
CREATE POLICY email_landing_pages_service_all ON public.email_landing_pages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same reasoning as increment_template_sent_count in 20260904180000_mailer_core.sql:
-- a tiny SECURITY DEFINER RPC rather than a raw UPDATE from the (public,
-- unauthenticated) subscribe route, so submit_count is bumped without
-- that route needing any broader table privilege than this one function.
CREATE OR REPLACE FUNCTION public.increment_landing_page_submit_count(
    p_landing_page_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.email_landing_pages
       SET submit_count = submit_count + 1
     WHERE id = p_landing_page_id;
$$;

-- ─── email_automated_triggers + email_automated_sends: lifecycle emails ──
-- A small FIXED set of lifecycle moments (like static_pages.FIXED_SLUGS'
-- pattern) rather than admin-creatable arbitrary triggers -- each is a
-- toggle + template + delay, dispatched by a pg_cron tick (see the
-- schedule-runner-style job below) that finds newly-eligible users and
-- sends at most once per (user, trigger) via email_automated_sends'
-- unique constraint.
CREATE TABLE IF NOT EXISTS public.email_automated_triggers (
    trigger_key   text        PRIMARY KEY CHECK (trigger_key IN ('welcome', 'no_subscription_nudge')),
    enabled       boolean     NOT NULL DEFAULT false,
    template_id   uuid        REFERENCES public.email_templates(id) ON DELETE SET NULL,
    -- Hours after the triggering event (signup, for both triggers today)
    -- before sending. 0 = as soon as the next dispatcher tick sees it.
    delay_hours   integer     NOT NULL DEFAULT 0 CHECK (delay_hours >= 0),
    updated_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.email_automated_triggers (trigger_key, enabled, delay_hours) VALUES
    ('welcome', false, 0),
    ('no_subscription_nudge', false, 24)
ON CONFLICT (trigger_key) DO NOTHING;

DROP TRIGGER IF EXISTS trg_email_automated_triggers_updated ON public.email_automated_triggers;
CREATE TRIGGER trg_email_automated_triggers_updated BEFORE UPDATE ON public.email_automated_triggers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_automated_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_automated_triggers_service_all ON public.email_automated_triggers;
CREATE POLICY email_automated_triggers_service_all ON public.email_automated_triggers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.email_automated_sends (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    trigger_key   text        NOT NULL REFERENCES public.email_automated_triggers(trigger_key) ON DELETE CASCADE,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, trigger_key)
);

ALTER TABLE public.email_automated_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_automated_sends_service_all ON public.email_automated_sends;
CREATE POLICY email_automated_sends_service_all ON public.email_automated_sends FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── mailer_audit_log: admin action audit trail ──────────────────────────
CREATE TABLE IF NOT EXISTS public.mailer_audit_log (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email   text,
    action        text        NOT NULL,   -- e.g. 'template.create', 'campaign.send', 'suppression.add', 'sender.update'
    target_type   text,                   -- e.g. 'template', 'campaign', 'group', 'suppression', 'sender_config'
    target_id     text,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailer_audit_log_created ON public.mailer_audit_log(created_at DESC);

ALTER TABLE public.mailer_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mailer_audit_log_service_all ON public.mailer_audit_log;
CREATE POLICY mailer_audit_log_service_all ON public.mailer_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Dispatcher cron: mailer-automation-runner ───────────────────────────
-- Same idempotent-registration pattern as schedule-runner-tick in
-- 20260510160000_schedules.sql -- ticks every 15 minutes, calling a new
-- Edge Function (supabase/functions/mailer-automation-runner) that: (1)
-- sends any 'scheduled' campaign whose scheduled_at has passed, and (2)
-- evaluates email_automated_triggers against recently-eligible users
-- (new signups for 'welcome', still-no-subscription signups older than
-- delay_hours for 'no_subscription_nudge'), skipping anyone already in
-- email_automated_sends or email_suppressions.
DO $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_anon_key    FROM vault.decrypted_secrets WHERE name = 'anon_key';
  EXCEPTION WHEN OTHERS THEN
    v_supabase_url := NULL;
    v_anon_key := NULL;
  END;

  IF v_supabase_url IS NOT NULL AND v_anon_key IS NOT NULL THEN
    PERFORM cron.unschedule('mailer-automation-runner-tick') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'mailer-automation-runner-tick'
    );
    PERFORM cron.schedule(
      'mailer-automation-runner-tick',
      '*/15 * * * *',
      format(
        $cron$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', %L
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
        $cron$,
        v_supabase_url || '/functions/v1/mailer-automation-runner',
        'Bearer ' || v_anon_key
      )
    );
  END IF;
END;
$$;
