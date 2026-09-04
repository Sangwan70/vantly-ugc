-- Admin Mailer, scoped-down per the admin-replication-plan's own verdict:
-- build Templates, Groups, Branding, and Campaigns; skip the visual
-- drag-and-drop builder, Sender Options' multi-provider abstraction
-- (Settings -> Mailer / mailer_config already covers this, Resend-only),
-- Landing Pages, B2B Lists, and automated lifecycle triggers.
--
-- Branding is folded into the EXISTING mailer_config singleton (added by
-- 20260904130000_admin_settings.sql) rather than a new table/page -- it's
-- the same "one config row" shape the plan document itself describes for
-- Branding, and mailer_config already holds from_name/from_email/
-- reply_to_email; this just adds the two fields campaigns render into a
-- template's header/footer (logo_url, footer_text).
ALTER TABLE public.mailer_config
    ADD COLUMN IF NOT EXISTS logo_url    text,
    ADD COLUMN IF NOT EXISTS footer_text text;

-- ─── Templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL,
    subject       text        NOT NULL,
    html_content  text        NOT NULL,
    text_content  text,
    -- Documented {{variable}} names this template expects -- informational
    -- only (not enforced), shown in the admin UI so an editor knows what
    -- to fill in for preview/send-test/campaign. Substitution itself is a
    -- plain {{key}} string replace (apps/web/lib/mailer/render-template.ts),
    -- not a real template engine -- deliberately simple for v1, matching
    -- the plan document's "raw HTML editing + live preview is enough"
    -- verdict on skipping the visual builder.
    variables     text[]      NOT NULL DEFAULT '{}',
    status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    sent_count    integer     NOT NULL DEFAULT 0,
    created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_email_templates_updated ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_service_all ON public.email_templates;
CREATE POLICY email_templates_service_all ON public.email_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Groups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_groups (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL,
    -- 'manual': members[] is the actual recipient list, edited/uploaded by
    -- an admin. 'all_users': members[]/member_count are NOT a stored
    -- snapshot (a snapshot goes stale the moment someone new signs up) --
    -- the real recipient list is resolved fresh at send time by
    -- resolveGroupRecipients() (apps/web/lib/mailer/resolve-recipients.ts),
    -- which paginates every Supabase auth user the same way
    -- /api/admin/users already does past the 1000-row API cap. This is a
    -- deliberate simplification vs. the plan document's "sync from website
    -- users" (a stored, periodically-refreshed snapshot) -- correctness
    -- over that extra machinery for a v1.
    type          text        NOT NULL DEFAULT 'manual' CHECK (type IN ('manual', 'all_users')),
    members       text[]      NOT NULL DEFAULT '{}',
    member_count  integer     NOT NULL DEFAULT 0,
    created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_email_groups_updated ON public.email_groups;
CREATE TRIGGER trg_email_groups_updated BEFORE UPDATE ON public.email_groups
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_groups_service_all ON public.email_groups;
CREATE POLICY email_groups_service_all ON public.email_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── Campaigns ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_campaigns (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text        NOT NULL,
    -- No ON DELETE action (default NO ACTION/RESTRICT): a template with
    -- any campaign referencing it can't be hard-deleted -- archive it
    -- instead (email_templates.status). Same reasoning applies to
    -- group_id, except a group is allowed to be null-able so an ad-hoc
    -- recipient list (recipient_emails) can be used without a group.
    template_id       uuid        NOT NULL REFERENCES public.email_templates(id),
    group_id          uuid        REFERENCES public.email_groups(id),
    -- Additional/ad-hoc recipients, sent alongside group_id's resolved
    -- list if both are set (deduped at send time).
    recipient_emails  text[]      NOT NULL DEFAULT '{}',
    status            text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
    -- Merged into every recipient's template render alongside {{email}};
    -- per-recipient personalization beyond that isn't supported in v1.
    template_vars     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    total_recipients  integer     NOT NULL DEFAULT 0,
    total_sent        integer     NOT NULL DEFAULT 0,
    total_failed      integer     NOT NULL DEFAULT 0,
    sent_at           timestamptz,
    created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON public.email_campaigns(status);

DROP TRIGGER IF EXISTS trg_email_campaigns_updated ON public.email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated BEFORE UPDATE ON public.email_campaigns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_campaigns_service_all ON public.email_campaigns;
CREATE POLICY email_campaigns_service_all ON public.email_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic increment for email_templates.sent_count, called by the
-- campaign send route after a batch of sends succeeds. A plain
-- UPDATE ... SET sent_count = sent_count + N is already atomic at the row
-- level in Postgres, but this is expressed as a tiny RPC (rather than an
-- update issued straight from the route handler) so a concurrent send from
-- two different campaigns against the same template can't lose an
-- increment to a stale read -- not actually possible with a single SQL
-- UPDATE either way, but keeping the increment as one RPC call keeps the
-- route handler from having to special-case "template no longer exists"
-- on this best-effort side-update.
CREATE OR REPLACE FUNCTION public.increment_template_sent_count(
    p_template_id uuid,
    p_amount      integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.email_templates
       SET sent_count = sent_count + p_amount
     WHERE id = p_template_id;
$$;

COMMENT ON TABLE public.email_campaigns
    IS 'Send-now only in this pass -- no scheduling, no open/click/bounce tracking, no unsubscribe filtering (no unsubscribe table exists yet in this codebase). The send route (POST .../send) synchronously calls Resend''s batch API in chunks and caps total recipients per call -- see that route''s doc comment for the exact limit and the reasoning (a real async send queue is deliberately deferred, same as the plan document''s own note that Vantly''s existing pg_cron + edge-function dispatch pattern already covers recurring/large-batch sends whenever that''s actually wanted).';
