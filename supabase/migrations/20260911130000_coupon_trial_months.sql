-- Coupons Phase 1.5: trial_months coupon type ("free for N months, then
-- real billing").
--
-- Extends 20260904170000_add_coupons.sql's coupons table with a fourth
-- type, trial_months, alongside the existing percent_off/fixed_off/credits.
-- Unlike percent_off/fixed_off (recorded but never applied to a real
-- charge -- see that migration's header comment, unchanged and still true
-- after this migration), trial_months IS wired into live checkout: a
-- redeemed trial_months coupon creates a real Stripe/RazorPay subscription
-- immediately (full plan access + credits granted right away), with the
-- first real charge deferred N calendar months via each gateway's native
-- delayed-billing mechanism (Stripe subscription_data.trial_end, RazorPay
-- subscription start_at) -- see services/api-v2/src/routes/v1/billing/
-- checkout.ts and webhook-stripe.ts/webhook-razorpay.ts for the
-- application-level wiring this migration supports.
--
-- Two additions:
--   1) coupons.trial_months + an extended discount-matches-type CHECK, so
--      a malformed coupon (e.g. type='trial_months' with percent_off also
--      set) still can't be inserted, same rigor as the original three
--      types.
--   2) subscriptions.coupon_code -- a nullable, no-FK breadcrumb recording
--      which coupon (if any) produced a given subscription, for admin
--      visibility/debugging. No FK to coupons.id: coupons can be
--      deactivated or (per the immutability rule in
--      apps/web/app/api/admin/coupons/[id]/route.ts) never mutated in a
--      way that would orphan this, but a plain FK would block ever hard-
--      deleting a stale coupon row later. Same "durable code string, not a
--      reference" reasoning coupon_redemptions already uses implicitly by
--      storing plan_slug as text rather than a plans.id FK.

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_matches_type;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_type_check;

ALTER TABLE public.coupons
    ADD CONSTRAINT coupons_type_check
    CHECK (type IN ('percent_off', 'fixed_off', 'credits', 'trial_months'));

ALTER TABLE public.coupons
    ADD COLUMN IF NOT EXISTS trial_months integer CHECK (trial_months > 0);

ALTER TABLE public.coupons
    ADD CONSTRAINT coupons_discount_matches_type CHECK (
        (type = 'percent_off'  AND percent_off IS NOT NULL AND fixed_off_cents IS NULL AND credits_amount IS NULL AND trial_months IS NULL) OR
        (type = 'fixed_off'    AND fixed_off_cents IS NOT NULL AND percent_off IS NULL AND credits_amount IS NULL AND trial_months IS NULL) OR
        (type = 'credits'      AND credits_amount IS NOT NULL AND percent_off IS NULL AND fixed_off_cents IS NULL AND trial_months IS NULL) OR
        (type = 'trial_months' AND trial_months IS NOT NULL AND percent_off IS NULL AND fixed_off_cents IS NULL AND credits_amount IS NULL)
    );

COMMENT ON COLUMN public.coupons.trial_months
    IS 'For type=trial_months: how many calendar months of free/full plan access before the first real charge. Applied at checkout via each gateway''s native delayed-billing mechanism -- see checkout.ts.';

COMMENT ON TABLE public.coupons
    IS 'Internal discount codes. percent_off/fixed_off are not applied anywhere in checkout (see 20260904170000''s header comment). credits redemptions are live (add_purchased_credits via redeem_coupon). trial_months redemptions are live (checkout.ts creates a real deferred-billing subscription; redeem_coupon is called once the gateway confirms the trial, not synchronously at checkout).';

-- ── subscriptions.coupon_code ────────────────────────────────────────────

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS coupon_code text;

COMMENT ON COLUMN public.subscriptions.coupon_code
    IS 'Coupon code (if any) that produced this subscription, e.g. a trial_months redemption. Free text, no FK -- a durable breadcrumb, not a live reference (see migration header comment). NULL for ordinary subscriptions.';

-- ── redeem_coupon / validate_coupon: surface trial_months to callers ────
--
-- Both RPCs already handle an arbitrary coupon `type` generically except
-- for the type='credits' credit-grant branch in redeem_coupon (unchanged
-- here -- trial_months grants credits at the application layer via
-- checkout.ts + the webhook handlers, not inside this RPC, since the
-- credit amount depends on which plan the trial subscription is for,
-- something this RPC is never told). This just adds trial_months to both
-- functions' RETURN jsonb so callers can read the trial length back.

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
        'trial_months',     v_coupon.trial_months,
        'credit_result',    v_credit_result
    );
END;
$$;
COMMENT ON FUNCTION public.redeem_coupon(text, uuid, text)
    IS 'Atomically validate + redeem a coupon. Locks the coupon row (serializing concurrent redemptions of the same code) and counts this users existing redemptions inside the same transaction rather than relying on a UNIQUE constraint, so per_user_limit > 1 works correctly. trial_months coupons: credits are granted by the caller (checkout.ts / webhook handlers), not here -- this RPC only records the redemption.';

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
        'credits_amount',   v_coupon.credits_amount,
        'trial_months',     v_coupon.trial_months
    );
END;
$$;
COMMENT ON FUNCTION public.validate_coupon(text, uuid, text)
    IS 'Read-only coupon eligibility check -- never mutates or locks anything, so checking a code can never burn a redemption.';
