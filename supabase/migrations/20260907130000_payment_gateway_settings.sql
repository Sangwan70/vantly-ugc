-- Payment Gateway Settings: admin-configurable gateway selection + credentials,
-- surfaced at Settings -> Payment Gateways (apps/web/.../admin/settings).
--
-- Today Stripe/RazorPay credentials are env-var-only (gateway-admin.ts's
-- getStripeSecretKey/getRazorpayCredentials, and separately the live-checkout
-- Edge Functions' own Deno.env reads in _shared/razorpay.ts) and gateway
-- selection for live checkout is the Edge Functions' own PAYMENT_GATEWAY
-- secret (a deploy-time choice -- see _shared/razorpay.ts's doc comment).
-- This table is the admin-UI-facing equivalent for the *admin Plans minting*
-- surface only (apps/web/lib/billing/gateway-admin.ts +
-- plan-gateway-sync.ts): it lets an admin enter Stripe/RazorPay/PayPal
-- credentials here instead of (or in addition to) env vars, and records
-- which one the admin currently intends as "active" for that surface.
--
-- IMPORTANT: this does NOT rewire the live checkout/webhook Edge Functions
-- (checkout/index.ts, webhook-stripe, webhook-razorpay) -- those still read
-- their own PAYMENT_GATEWAY/STRIPE_*/RAZORPAY_* Edge Function secrets,
-- exactly like the `plans` table itself (20260904160000_plans_table.sql)
-- deliberately does not yet drive live checkout. Rewiring live checkout onto
-- admin-configured settings is a separate, later change.
--
-- Singleton row (id = 'default'), same shape as mailer_config: secrets are
-- nullable optional overrides of the matching env var, RLS is service-role
-- only, and the API route never echoes a stored secret back to the browser
-- (see api/admin/settings/payment-gateways/route.ts).
CREATE TABLE IF NOT EXISTS public.payment_gateway_settings (
  id                     text PRIMARY KEY DEFAULT 'default',
  -- Which gateway the admin Payment Gateways tab currently has selected.
  -- Informational for now (see comment above) -- does not itself switch
  -- live checkout traffic.
  active_gateway         text NOT NULL DEFAULT 'stripe' CHECK (active_gateway IN ('stripe', 'razorpay', 'paypal')),
  stripe_secret_key      text,                                  -- overrides STRIPE_SECRET_KEY when set
  razorpay_key_id        text,                                  -- overrides RAZORPAY_API_KEY when set
  razorpay_key_secret    text,                                  -- overrides RAZORPAY_API_SECRET when set
  paypal_client_id       text,                                  -- no env-var equivalent exists yet
  paypal_client_secret   text,
  paypal_mode            text NOT NULL DEFAULT 'live' CHECK (paypal_mode IN ('live', 'sandbox')),
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_gateway_settings_singleton CHECK (id = 'default')
);
INSERT INTO public.payment_gateway_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_payment_gateway_settings_updated ON public.payment_gateway_settings;
CREATE TRIGGER trg_payment_gateway_settings_updated BEFORE UPDATE ON public.payment_gateway_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_gateway_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_gateway_settings_service_all ON public.payment_gateway_settings;
CREATE POLICY payment_gateway_settings_service_all ON public.payment_gateway_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Third gateway id column on the existing Phase-1 plans table, alongside
-- stripe_price_id/razorpay_plan_id (20260904160000_plans_table.sql). Same
-- rules apply: PayPal Plans are immutable once created, so a price change
-- mints a fresh one rather than updating in place -- see
-- plan-gateway-sync.ts's mintMissingGatewayIds.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS paypal_plan_id text;
COMMENT ON COLUMN public.plans.paypal_plan_id
  IS 'PayPal Billing Plan id (P-xxx), minted the same way stripe_price_id/razorpay_plan_id are -- see plan-gateway-sync.ts.';
