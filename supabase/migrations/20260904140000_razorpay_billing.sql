-- RazorPay payment gateway support.
--
-- Vantly's existing billing (subscriptions, checkout, webhook-stripe) is
-- Stripe-only and USD-only. This migration adds the columns and tables
-- needed to run RazorPay (INR) as an alternative gateway, selected at
-- deploy time via the PAYMENT_GATEWAY Edge Function secret (mirrors how
-- github.com/Significant-Gravitas/AutoGPT's platform does it) -- see
-- supabase/functions/_shared/razorpay.ts and supabase/functions/webhook-razorpay.
--
-- Design choices carried over from Stripe's schema, kept parallel rather
-- than merged, so neither gateway's columns/constraints depend on the
-- other:
--   - subscriptions gets its own razorpay_* columns alongside the existing
--     stripe_* ones, plus a payment_gateway column recording which gateway
--     a given row was created under (a self-hoster can only run ONE
--     gateway at a time via PAYMENT_GATEWAY, but historical rows must
--     stay attributable if they ever switch).
--   - razorpay_webhook_events mirrors stripe_webhook_events exactly
--     (idempotent-by-event-id, processed_at nullable so a crashed
--     in-flight attempt is retried rather than skipped).
--   - add_purchased_credits_razorpay mirrors add_purchased_credits, keyed
--     on razorpay_payment_id instead of stripe_payment_intent_id, so PAYG
--     purchases through either gateway are equally safe against duplicate
--     webhook delivery.
--   - dead_letter_webhooks is reused as-is (provider_slug is free text,
--     already 'stripe' for the existing gateway -- 'razorpay' needs no
--     schema change).

-- 1) subscriptions: RazorPay identifiers + which gateway created this row.
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS payment_gateway       text NOT NULL DEFAULT 'stripe'
                              CHECK (payment_gateway IN ('stripe', 'razorpay')),
    ADD COLUMN IF NOT EXISTS razorpay_customer_id   text,
    ADD COLUMN IF NOT EXISTS razorpay_subscription_id text UNIQUE,
    ADD COLUMN IF NOT EXISTS razorpay_plan_id       text;

COMMENT ON COLUMN public.subscriptions.payment_gateway
    IS 'Which gateway created/owns this subscription row. A deployment runs one gateway at a time (PAYMENT_GATEWAY env var); this records history across a switch.';
COMMENT ON COLUMN public.subscriptions.razorpay_subscription_id
    IS 'RazorPay Subscription ID (sub_xxx). The source of truth is the subscription.* webhook events, not this app reading it back.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_subscription
    ON public.subscriptions(razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;

-- 2) razorpay_webhook_events -- idempotency ledger, mirrors stripe_webhook_events.
CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    razorpay_event_id  text        UNIQUE NOT NULL,
    event_type         text        NOT NULL,
    processed_at       timestamptz,
    payload            jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.razorpay_webhook_events
    IS 'Tracks processed RazorPay webhook events for idempotent handling. Check razorpay_event_id before processing any event.';

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events_type
    ON public.razorpay_webhook_events(event_type);

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS razorpay_webhook_events_service_all ON public.razorpay_webhook_events;
CREATE POLICY razorpay_webhook_events_service_all ON public.razorpay_webhook_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) credit_transactions: RazorPay payment id, for PAYG reconciliation + dedup.
ALTER TABLE public.credit_transactions
    ADD COLUMN IF NOT EXISTS razorpay_payment_id text;

COMMENT ON COLUMN public.credit_transactions.razorpay_payment_id
    IS 'RazorPay payment ID for PAYG credit purchases via RazorPay. Used for reconciliation.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_razorpay_payment
    ON public.credit_transactions(razorpay_payment_id)
    WHERE razorpay_payment_id IS NOT NULL AND type = 'purchase_credit';

-- 4) add_purchased_credits_razorpay -- mirrors add_purchased_credits (see
-- 20260424000001_reliable_payg_crediting.sql) but keyed on
-- razorpay_payment_id. Kept as a separate function (rather than adding an
-- optional razorpay id param to the existing one) so neither gateway's
-- crediting path can be broken by a change made for the other.
CREATE OR REPLACE FUNCTION public.add_purchased_credits_razorpay(
    p_user_id             uuid,
    p_amount              integer,
    p_razorpay_payment_id text DEFAULT NULL,
    p_description         text DEFAULT 'PAYG credit purchase (RazorPay)'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_monthly              integer;
    v_new_purchased            integer;
    v_existing_transaction_id  uuid;
    v_existing_user_id         uuid;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: user_id cannot be null';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: amount must be positive';
    END IF;

    IF p_razorpay_payment_id IS NOT NULL AND btrim(p_razorpay_payment_id) <> '' THEN
        -- Serialize by RazorPay payment ID to make concurrent webhook
        -- retries safe.
        PERFORM pg_advisory_xact_lock(
            hashtextextended('add_purchased_credits_razorpay:' || p_razorpay_payment_id, 0)
        );

        SELECT id, user_id
          INTO v_existing_transaction_id, v_existing_user_id
          FROM public.credit_transactions
         WHERE razorpay_payment_id = p_razorpay_payment_id
           AND type = 'purchase_credit'
         ORDER BY created_at
         LIMIT 1;

        IF FOUND THEN
            IF v_existing_user_id <> p_user_id THEN
                RAISE EXCEPTION
                    'PAYMENT_ALREADY_CREDITED: % belongs to a different user',
                    p_razorpay_payment_id;
            END IF;

            SELECT monthly_credits_remaining, purchased_balance
              INTO v_new_monthly, v_new_purchased
              FROM public.user_credits
             WHERE user_id = p_user_id;

            RETURN jsonb_build_object(
                'success',                 true,
                'duplicate',               true,
                'credits_added',           0,
                'existing_transaction_id', v_existing_transaction_id,
                'new_monthly',             COALESCE(v_new_monthly, 0),
                'new_purchased',           COALESCE(v_new_purchased, 0)
            );
        END IF;
    END IF;

    -- Atomic upsert: create row if missing, or increment purchased_balance.
    INSERT INTO public.user_credits (user_id, monthly_credits_remaining, purchased_balance)
    VALUES (p_user_id, 0, p_amount)
    ON CONFLICT (user_id)
    DO UPDATE SET purchased_balance = user_credits.purchased_balance + EXCLUDED.purchased_balance;

    -- Read the final balances under a row lock for accurate ledger entry.
    SELECT monthly_credits_remaining, purchased_balance
      INTO v_new_monthly, v_new_purchased
      FROM public.user_credits
     WHERE user_id = p_user_id
     FOR UPDATE;

    INSERT INTO public.credit_transactions (
        user_id,
        type,
        amount,
        bucket,
        running_monthly_balance,
        running_purchased_balance,
        razorpay_payment_id,
        description
    ) VALUES (
        p_user_id,
        'purchase_credit',
        p_amount,
        'purchased',
        v_new_monthly,
        v_new_purchased,
        NULLIF(btrim(p_razorpay_payment_id), ''),
        p_description
    );

    RETURN jsonb_build_object(
        'success',       true,
        'duplicate',     false,
        'credits_added', p_amount,
        'new_monthly',   v_new_monthly,
        'new_purchased', v_new_purchased
    );
END;
$$;
COMMENT ON FUNCTION public.add_purchased_credits_razorpay(uuid, integer, text, text)
    IS 'Atomically add purchased credits from a RazorPay PAYG payment. Idempotent for non-null RazorPay payment IDs.';
