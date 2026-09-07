-- PayPal payment gateway support (live checkout/webhooks).
--
-- Mirrors 20260904140000_razorpay_billing.sql's approach: PayPal gets its
-- own parallel set of columns/tables alongside the existing Stripe/RazorPay
-- ones, kept separate rather than merged so no gateway's idempotency or
-- constraints depend on another's. Written for the api-v2 live-checkout
-- port (services/api-v2/src/routes/v1/billing/*.ts) — payment_gateway_settings
-- (20260907130000_payment_gateway_settings.sql) already lets an admin select
-- "paypal" as the active gateway; this is what makes that selection actually
-- work end-to-end (subscriptions + PAYG credit purchases) rather than
-- checkout throwing "not implemented".
--
-- Design choices carried over from RazorPay's schema:
--   - subscriptions gets its own paypal_subscription_id column, and
--     payment_gateway's CHECK constraint is widened to allow 'paypal'.
--   - paypal_webhook_events mirrors stripe_webhook_events/razorpay_webhook_events
--     exactly (idempotent-by-event-id, processed_at nullable).
--   - add_purchased_credits_paypal mirrors add_purchased_credits_razorpay,
--     keyed on a PayPal capture id instead of a RazorPay payment id.
--   - dead_letter_webhooks is reused as-is (provider_slug is free text;
--     'paypal' needs no schema change there).

-- 1) subscriptions: PayPal identifier + widen payment_gateway's allowed values.
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_payment_gateway_check;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_payment_gateway_check
        CHECK (payment_gateway IN ('stripe', 'razorpay', 'paypal'));

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS paypal_subscription_id text UNIQUE;

COMMENT ON COLUMN public.subscriptions.paypal_subscription_id
    IS 'PayPal Subscription ID (I-xxx). The source of truth is the BILLING.SUBSCRIPTION.* webhook events, not this app reading it back.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_paypal_subscription
    ON public.subscriptions(paypal_subscription_id) WHERE paypal_subscription_id IS NOT NULL;

-- 2) paypal_webhook_events -- idempotency ledger, mirrors
-- stripe_webhook_events / razorpay_webhook_events. Keyed on PayPal's own
-- webhook event "id" field (unlike RazorPay, PayPal DOES send a stable
-- event id per delivery, so no body-hash workaround is needed here).
CREATE TABLE IF NOT EXISTS public.paypal_webhook_events (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    paypal_event_id   text        UNIQUE NOT NULL,
    event_type        text        NOT NULL,
    processed_at      timestamptz,
    payload           jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.paypal_webhook_events
    IS 'Tracks processed PayPal webhook events for idempotent handling. Check paypal_event_id before processing any event.';

CREATE INDEX IF NOT EXISTS idx_paypal_webhook_events_type
    ON public.paypal_webhook_events(event_type);

ALTER TABLE public.paypal_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paypal_webhook_events_service_all ON public.paypal_webhook_events;
CREATE POLICY paypal_webhook_events_service_all ON public.paypal_webhook_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) credit_transactions: PayPal capture id, for PAYG reconciliation + dedup.
ALTER TABLE public.credit_transactions
    ADD COLUMN IF NOT EXISTS paypal_capture_id text;

COMMENT ON COLUMN public.credit_transactions.paypal_capture_id
    IS 'PayPal Capture ID for PAYG credit purchases via PayPal. Used for reconciliation.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_paypal_capture
    ON public.credit_transactions(paypal_capture_id)
    WHERE paypal_capture_id IS NOT NULL AND type = 'purchase_credit';

-- 4) add_purchased_credits_paypal -- mirrors add_purchased_credits_razorpay
-- but keyed on paypal_capture_id. Kept as a separate function so neither
-- gateway's crediting path can be broken by a change made for another.
CREATE OR REPLACE FUNCTION public.add_purchased_credits_paypal(
    p_user_id            uuid,
    p_amount             integer,
    p_paypal_capture_id  text DEFAULT NULL,
    p_description        text DEFAULT 'PAYG credit purchase (PayPal)'
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

    IF p_paypal_capture_id IS NOT NULL AND btrim(p_paypal_capture_id) <> '' THEN
        -- Serialize by PayPal capture ID to make concurrent webhook/capture
        -- retries safe (the api-v2 route captures directly on
        -- CHECKOUT.ORDER.APPROVED AND handles PAYMENT.CAPTURE.COMPLETED --
        -- both paths call this function with the same capture id).
        PERFORM pg_advisory_xact_lock(
            hashtextextended('add_purchased_credits_paypal:' || p_paypal_capture_id, 0)
        );

        SELECT id, user_id
          INTO v_existing_transaction_id, v_existing_user_id
          FROM public.credit_transactions
         WHERE paypal_capture_id = p_paypal_capture_id
           AND type = 'purchase_credit'
         ORDER BY created_at
         LIMIT 1;

        IF FOUND THEN
            IF v_existing_user_id <> p_user_id THEN
                RAISE EXCEPTION
                    'PAYMENT_ALREADY_CREDITED: % belongs to a different user',
                    p_paypal_capture_id;
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
        paypal_capture_id,
        description
    ) VALUES (
        p_user_id,
        'purchase_credit',
        p_amount,
        'purchased',
        v_new_monthly,
        v_new_purchased,
        NULLIF(btrim(p_paypal_capture_id), ''),
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
COMMENT ON FUNCTION public.add_purchased_credits_paypal(uuid, integer, text, text)
    IS 'Atomically add purchased credits from a PayPal PAYG payment. Idempotent for non-null PayPal capture IDs.';
