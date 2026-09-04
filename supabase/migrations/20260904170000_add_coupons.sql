-- Admin Coupons, Phase 1: internal discount-code system.
--
-- Modeled on the admin-replication-plan's "Admin Coupons" investigation,
-- adapted to what already exists in this codebase rather than ported
-- verbatim. Two deliberate departures from the plan document:
--
-- 1) No native Stripe Coupon/PromotionCode objects. apps/web has no Stripe
--    npm package (billing lives in Deno Edge Functions), and checkout has
--    no discount-application path today. This is built as a fully
--    internal system -- code -> discount-or-credits, validated and
--    redeemed against Postgres -- exactly as the plan's own "Replication
--    plan" section recommends for a first version.
--
-- 2) Per-user redemption limits are enforced by locking the coupon row
--    (SELECT ... FOR UPDATE in redeem_coupon) and counting existing
--    coupon_redemptions rows inside that same transaction, NOT by a
--    UNIQUE(coupon_id, user_id) constraint. A blanket unique constraint
--    only works for per_user_limit = 1 and would incorrectly block a
--    legitimate second redemption when an admin sets a higher limit --
--    the plan document itself flags this exact tradeoff ("drop for
--    per_user_limit > 1 and enforce count in the RPC"). Locking the
--    coupon row also serializes concurrent redemption attempts for the
--    same code, which is what actually prevents the race Vantly's own
--    invite-redeem function is explicitly documented as NOT preventing
--    (see the RPC comment below) -- this is the one prior-art bug in this
--    codebase this feature exists partly to not repeat.
--
-- Phase 1 scope (this migration + admin CRUD + a validate-only public
-- route): create, list, deactivate coupons; validate a code; redeem a
-- CREDITS-type coupon (adds real credits via the existing
-- add_purchased_credits RPC). Applying a PERCENT_OFF/FIXED_OFF discount to
-- an actual Stripe charge is deliberately NOT wired into checkout/index.ts
-- in this pass -- that touches live checkout price computation, the same
-- class of change the Admin Plans milestone's Phase 2 was held back for,
-- and needs its own checkpointed follow-up rather than landing silently
-- alongside admin CRUD.

CREATE TABLE IF NOT EXISTS public.coupons (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text        UNIQUE NOT NULL,
    description         text,
    type                text        NOT NULL CHECK (type IN ('percent_off', 'fixed_off', 'credits')),
    -- Exactly one of these three is set, matching `type` -- enforced below
    -- so a malformed coupon (e.g. type='credits' with percent_off set)
    -- can't be inserted in the first place, tighter than the plan
    -- document's version of this table.
    percent_off         integer     CHECK (percent_off BETWEEN 1 AND 100),
    fixed_off_cents     integer     CHECK (fixed_off_cents > 0),
    credits_amount      integer     CHECK (credits_amount > 0),
    -- Plan slugs this coupon applies to; empty = all plans.
    applicable_plans    text[]      NOT NULL DEFAULT '{}',
    -- NULL = unlimited redemptions globally.
    max_redemptions     integer     CHECK (max_redemptions > 0),
    times_redeemed      integer     NOT NULL DEFAULT 0,
    per_user_limit      integer     NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
    valid_from          timestamptz,
    valid_until         timestamptz,
    is_active           boolean     NOT NULL DEFAULT true,
    created_by          uuid        REFERENCES public.profiles(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coupons_discount_matches_type CHECK (
        (type = 'percent_off' AND percent_off IS NOT NULL AND fixed_off_cents IS NULL AND credits_amount IS NULL) OR
        (type = 'fixed_off'   AND fixed_off_cents IS NOT NULL AND percent_off IS NULL AND credits_amount IS NULL) OR
        (type = 'credits'     AND credits_amount IS NOT NULL AND percent_off IS NULL AND fixed_off_cents IS NULL)
    )
);

COMMENT ON TABLE public.coupons
    IS 'Internal discount codes. percent_off/fixed_off are not yet applied anywhere in checkout -- see migration header comment. credits redemptions ARE live (call add_purchased_credits via redeem_coupon).';

CREATE INDEX IF NOT EXISTS idx_coupons_code_active ON public.coupons(code) WHERE is_active = true;

DROP TRIGGER IF EXISTS coupons_updated_at ON public.coupons;
CREATE TRIGGER coupons_updated_at
    BEFORE UPDATE ON public.coupons
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
-- No public policy -- every read/write goes through the SECURITY DEFINER
-- RPCs below or a service-role admin route, same convention as
-- public.plans (see 20260904160000_plans_table.sql).

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id       uuid        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
    -- CASCADE on user delete, consistent with the "delete-user is a true
    -- hard delete, no retained trace" decision this table's sibling
    -- migration (20260904150000_admin_user_moderation.sql) already made
    -- for generation_jobs/credit_transactions.
    user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan_slug       text,
    redeemed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coupon_redemptions
    IS 'One row per successful redemption. Per-user limits are enforced in redeem_coupon() by locking the coupon row and counting rows here inside the same transaction -- deliberately no UNIQUE(coupon_id, user_id) constraint, see migration header comment.';

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_user ON public.coupon_redemptions(coupon_id, user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON public.coupon_redemptions(user_id);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
-- No public policy here either -- redemption history is read by admin
-- routes (service-role) only for now.

-- ─── redeem_coupon ───────────────────────────────────────────────────────
--
-- Atomically validate and redeem a coupon. Locks the coupon row for the
-- duration of the transaction (SELECT ... FOR UPDATE), which serializes
-- every concurrent redemption attempt for the same code -- this is the
-- actual fix for the race Vantly's own invite-redeem function
-- (supabase/functions/invite-redeem/index.ts) has: that function does a
-- read-then-write, non-atomic used_count increment with no per-user
-- tracking, so two concurrent redeems of the same code can both succeed
-- past a cap that should have stopped the second one. This function does
-- not repeat that.
--
-- CREDITS-type coupons actually grant credits (via add_purchased_credits,
-- the same idempotent RPC PAYG purchases use). PERCENT_OFF/FIXED_OFF
-- coupons are recorded as redeemed and their discount fields are returned
-- to the caller, but nothing here touches a live Stripe charge -- see
-- migration header comment for why that's deliberately out of scope for
-- this pass.
CREATE OR REPLACE FUNCTION public.redeem_coupon(
    p_code      text,
    p_user_id   uuid,
    p_plan_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupon                public.coupons%ROWTYPE;
    v_user_redemption_count integer;
    v_redemption_id         uuid;
    v_credit_result         jsonb;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: user_id cannot be null';
    END IF;
    IF p_code IS NULL OR btrim(p_code) = '' THEN
        RAISE EXCEPTION 'INVALID_INPUT: code cannot be empty';
    END IF;

    -- Lock the coupon row for the rest of this transaction. Any other
    -- concurrent redeem_coupon call for the same code blocks here until
    -- this transaction commits or rolls back.
    SELECT * INTO v_coupon
      FROM public.coupons
     WHERE code = upper(btrim(p_code))
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COUPON_NOT_FOUND: no such coupon code';
    END IF;
    IF NOT v_coupon.is_active THEN
        RAISE EXCEPTION 'COUPON_INACTIVE: this coupon is no longer active';
    END IF;
    IF v_coupon.valid_from IS NOT NULL AND now() < v_coupon.valid_from THEN
        RAISE EXCEPTION 'COUPON_NOT_YET_VALID: this coupon is not active yet';
    END IF;
    IF v_coupon.valid_until IS NOT NULL AND now() > v_coupon.valid_until THEN
        RAISE EXCEPTION 'COUPON_EXPIRED: this coupon has expired';
    END IF;
    IF p_plan_slug IS NOT NULL
       AND COALESCE(array_length(v_coupon.applicable_plans, 1), 0) > 0
       AND NOT (p_plan_slug = ANY(v_coupon.applicable_plans)) THEN
        RAISE EXCEPTION 'COUPON_NOT_APPLICABLE_TO_PLAN: this coupon does not apply to plan %', p_plan_slug;
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL AND v_coupon.times_redeemed >= v_coupon.max_redemptions THEN
        RAISE EXCEPTION 'COUPON_REDEMPTION_LIMIT_REACHED: this coupon has been fully redeemed';
    END IF;

    SELECT count(*) INTO v_user_redemption_count
      FROM public.coupon_redemptions
     WHERE coupon_id = v_coupon.id AND user_id = p_user_id;
    IF v_user_redemption_count >= v_coupon.per_user_limit THEN
        RAISE EXCEPTION 'COUPON_ALREADY_REDEEMED_BY_USER: you have already redeemed this coupon';
    END IF;

    INSERT INTO public.coupon_redemptions (coupon_id, user_id, plan_slug)
    VALUES (v_coupon.id, p_user_id, p_plan_slug)
    RETURNING id INTO v_redemption_id;

    UPDATE public.coupons
       SET times_redeemed = times_redeemed + 1
     WHERE id = v_coupon.id;

    IF v_coupon.type = 'credits' THEN
        v_credit_result := public.add_purchased_credits(
            p_user_id,
            v_coupon.credits_amount,
            NULL,
            'Coupon redemption: ' || v_coupon.code
        );
    END IF;

    RETURN jsonb_build_object(
        'success',          true,
        'redemption_id',    v_redemption_id,
        'coupon_code',      v_coupon.code,
        'type',             v_coupon.type,
        'percent_off',      v_coupon.percent_off,
        'fixed_off_cents',  v_coupon.fixed_off_cents,
        'credits_amount',   v_coupon.credits_amount,
        'credit_result',    v_credit_result
    );
END;
$$;
COMMENT ON FUNCTION public.redeem_coupon(text, uuid, text)
    IS 'Atomically validate + redeem a coupon. Locks the coupon row (serializing concurrent redemptions of the same code) and counts this users existing redemptions inside the same transaction rather than relying on a UNIQUE constraint, so per_user_limit > 1 works correctly.';

-- ─── validate_coupon ─────────────────────────────────────────────────────
--
-- Read-only eligibility check -- deliberately does NOT lock the coupon row
-- or write anything, so a user checking whether a code is valid can never
-- burn a redemption (the plan document's own explicit gotcha: "validating
-- should never burn a redemption; only redeem after the charge actually
-- succeeds, or a user can lose their one shot on an abandoned/failed
-- checkout"). Same eligibility rules as redeem_coupon, applied without FOR
-- UPDATE, so this is a best-effort preview: a coupon that validates here
-- can still fail to redeem a moment later if another request wins the
-- race first (that race is exactly what redeem_coupon's row lock exists
-- to resolve correctly at the only point that actually matters).
CREATE OR REPLACE FUNCTION public.validate_coupon(
    p_code      text,
    p_user_id   uuid DEFAULT NULL,
    p_plan_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupon                public.coupons%ROWTYPE;
    v_user_redemption_count integer;
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'EMPTY_CODE');
    END IF;

    SELECT * INTO v_coupon FROM public.coupons WHERE code = upper(btrim(p_code));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_FOUND');
    END IF;
    IF NOT v_coupon.is_active THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_INACTIVE');
    END IF;
    IF v_coupon.valid_from IS NOT NULL AND now() < v_coupon.valid_from THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_YET_VALID');
    END IF;
    IF v_coupon.valid_until IS NOT NULL AND now() > v_coupon.valid_until THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_EXPIRED');
    END IF;
    IF p_plan_slug IS NOT NULL
       AND COALESCE(array_length(v_coupon.applicable_plans, 1), 0) > 0
       AND NOT (p_plan_slug = ANY(v_coupon.applicable_plans)) THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_NOT_APPLICABLE_TO_PLAN');
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL AND v_coupon.times_redeemed >= v_coupon.max_redemptions THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_REDEMPTION_LIMIT_REACHED');
    END IF;

    IF p_user_id IS NOT NULL THEN
        SELECT count(*) INTO v_user_redemption_count
          FROM public.coupon_redemptions
         WHERE coupon_id = v_coupon.id AND user_id = p_user_id;
        IF v_user_redemption_count >= v_coupon.per_user_limit THEN
            RETURN jsonb_build_object('valid', false, 'reason', 'COUPON_ALREADY_REDEEMED_BY_USER');
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'valid',            true,
        'coupon_code',      v_coupon.code,
        'description',      v_coupon.description,
        'type',             v_coupon.type,
        'percent_off',      v_coupon.percent_off,
        'fixed_off_cents',  v_coupon.fixed_off_cents,
        'credits_amount',   v_coupon.credits_amount
    );
END;
$$;
COMMENT ON FUNCTION public.validate_coupon(text, uuid, text)
    IS 'Read-only coupon eligibility check -- never mutates or locks anything, so checking a code can never burn a redemption.';
