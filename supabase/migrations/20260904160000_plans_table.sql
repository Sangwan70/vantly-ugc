-- Canonical `plans` table for the Admin Plans panel.
--
-- Vantly's plan/price data was hardcoded, redundantly, in at least six
-- places that don't fully agree with each other: webhook-stripe/plans.ts
-- (now re-exporting from _shared/plans.ts), checkout/index.ts's own
-- getPlanDefinitions() (Stripe price ids only), credits-check/index.ts's
-- PLAN_CONFIGS (generation-time limits), apps/web's subscribe/page.tsx and
-- onboarding/plan/page.tsx (marketing copy + price), grant-subscription's
-- PLAN_CREDITS, and two different stale PLAN_TIERS constants in
-- packages/types and packages/schema. This table is step one of
-- reconciling them: it seeds from the values those sources already agree
-- on (cross-checked 2026-09-04), but nothing reads from it YET -- every
-- consumer above still reads its own hardcoded copy. Rewiring each
-- consumer onto this table is deliberately a separate, later change: it
-- touches live checkout and the credits-check function that gates every
-- generation request, so it needs its own careful, one-consumer-at-a-time
-- pass rather than landing in the same migration that introduces the table.
--
-- Unlike the original cross-platform investigation (written before RazorPay
-- was wired up), this includes razorpay_plan_id alongside stripe_price_id --
-- RazorPay is Vantly's default gateway now, not something to skip.
CREATE TABLE IF NOT EXISTS public.plans (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                        text UNIQUE NOT NULL,
    display_name                text NOT NULL,
    description                 text,
    badge                       text,
    bg_image_url                text,
    features                    jsonb NOT NULL DEFAULT '[]'::jsonb,
    monthly_credits             integer NOT NULL DEFAULT 0,
    -- USD cents; null = not purchasable through checkout (free tier, or a
    -- legacy/deprecated tier kept only for existing subscribers).
    price_usd_cents             integer,
    max_resolution              text,
    max_video_duration_seconds  integer,
    has_watermark               boolean NOT NULL DEFAULT true,
    has_priority                boolean NOT NULL DEFAULT false,
    has_api_access              boolean NOT NULL DEFAULT false,
    max_concurrent_jobs         integer NOT NULL DEFAULT 1,
    -- Both null until an admin explicitly syncs -- see the sync-gateway
    -- route's doc comment for why this table doesn't try to adopt the
    -- currently-live env-var-configured price/plan ids automatically.
    stripe_price_id             text,
    razorpay_plan_id            text,
    is_active                   boolean NOT NULL DEFAULT true,
    -- false for tiers that exist for display/legacy reasons but were never
    -- meant to be selected in checkout (free is the obvious case; a
    -- deprecated paid tier being sunset is another).
    is_purchasable               boolean NOT NULL DEFAULT true,
    sort_order                  integer NOT NULL DEFAULT 0,
    updated_by                  uuid REFERENCES public.profiles(id),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plans
    IS 'Canonical plan/tier definitions for the Admin Plans panel. Not yet read by checkout, webhook-stripe, webhook-razorpay, or credits-check -- see the migration header comment.';
COMMENT ON COLUMN public.plans.price_usd_cents
    IS 'Display/target price in USD cents. Changing this does not itself change what a live Stripe/RazorPay price charges -- see the admin plans PUT route, which mints a NEW gateway price/plan (both gateways treat prices as immutable) rather than mutating one a customer may already be subscribed to.';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plans_updated_at ON public.plans;
CREATE TRIGGER plans_updated_at
    BEFORE UPDATE ON public.plans
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_plans_is_active ON public.plans(is_active) WHERE is_active = true;

-- RLS: no public policy. Admin routes use the service-role client (same
-- pattern as every other apps/web/app/api/admin/* route); a plan is never
-- read directly by an unauthenticated client today (subscribe/onboarding
-- pages still read their own hardcoded arrays, not this table).
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Seed rows, reconciled from the values that already agree across
-- _shared/plans.ts, credits-check/index.ts's PLAN_CONFIGS, and
-- subscribe/page.tsx's marketing copy. stripe_price_id/razorpay_plan_id
-- are left null -- today's real, live ids still come from env vars
-- (STRIPE_PRICE_STARTER etc. / RAZORPAY_PLAN_STARTER etc.), which this
-- table does not yet supersede.
INSERT INTO public.plans (slug, display_name, description, badge, features, monthly_credits, price_usd_cents, max_resolution, max_video_duration_seconds, has_watermark, has_priority, has_api_access, max_concurrent_jobs, is_active, is_purchasable, sort_order)
VALUES
    ('free', 'Free', 'Try Vantly with a one-time starter credit grant.', NULL,
     '[]'::jsonb, 0, NULL, '720p', 5, true, false, false, 1, true, false, 0),

    ('newby', 'Newby', 'Deprecated legacy tier -- kept for existing subscribers only, not offered to new users.', NULL,
     '[]'::jsonb, 1300, 1900, '1080p', 10, false, false, false, 2, false, false, 1),

    ('starter', 'Creator', 'For creators shipping UGC content consistently.', NULL,
     '["Up to 15s videos", "Full UGC generation pipeline", "CLI, MCP, REST API & SDKs"]'::jsonb,
     3900, 3900, '1080p', 10, false, false, false, 3, true, true, 2),

    ('creator', 'Pro', 'For professionals running production-scale content pipelines.', 'Most popular',
     '["Up to 15s videos", "Batch generation via CLI or API", "Persistent characters for campaigns", "Auto-publishing to social channels", "1080p exports with no watermark"]'::jsonb,
     6900, 6900, '2k', 15, false, true, false, 5, true, true, 3),

    ('pro_plus', 'Pro Plus', 'For high-volume teams and agencies.', NULL,
     '["Up to 15s videos", "Early access to newest models and higher quality", "Batch generation via CLI or API", "Auto-publishing to social channels", "1080p exports with no watermark"]'::jsonb,
     12900, 12900, '2k', 15, false, true, true, 10, true, true, 4)
ON CONFLICT (slug) DO NOTHING;
