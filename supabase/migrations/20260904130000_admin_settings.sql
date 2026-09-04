-- Admin Settings foundation: General (site branding), Currency (multi-currency
-- charging config), and Mailer (transactional-email sender/branding config).
--
-- All three are admin-only config surfaces read/written exclusively through
-- /api/admin/settings/* route handlers using the service-role client (same
-- pattern as every other /api/admin/* route in this app) — never read
-- directly from the browser, so RLS here is service_role-only, no public or
-- owner policies. updated_at via the existing set_updated_at() trigger.
--
-- currencies is deliberately just the config layer (which currencies are
-- enabled, their display symbol, and their USD exchange rate) that a future
-- Plans feature will read when minting per-currency Stripe Prices — this
-- migration does not touch checkout/webhook-stripe or add gateway price IDs.

-- 1) site_settings — singleton row (id = 'default'). General branding/SEO.
CREATE TABLE IF NOT EXISTS public.site_settings (
  id                text PRIMARY KEY DEFAULT 'default',
  website_name      text,
  support_email     text,
  seo_description   text,
  company_address   text,
  social_links      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {platform: url}
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_singleton CHECK (id = 'default')
);
INSERT INTO public.site_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_site_settings_updated ON public.site_settings;
CREATE TRIGGER trg_site_settings_updated BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_settings_service_all ON public.site_settings;
CREATE POLICY site_settings_service_all ON public.site_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) currencies — one row per supported currency. USD is seeded as the
-- always-present default (matches Stripe's current USD-only checkout).
CREATE TABLE IF NOT EXISTS public.currencies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text UNIQUE NOT NULL,             -- ISO 4217, e.g. 'USD', 'INR', 'EUR'
  symbol                   text NOT NULL,                     -- e.g. '$', '₹', '€'
  name                     text NOT NULL,                     -- e.g. 'US Dollar'
  -- amount_in_currency = amount_usd * exchange_rate_to_usd. USD's own row is
  -- always 1 (enforced below) so it can anchor conversions for every other row.
  exchange_rate_to_usd     numeric(18,6) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_usd > 0),
  is_active                boolean NOT NULL DEFAULT true,      -- chargeable / shown to admins as available
  is_default               boolean NOT NULL DEFAULT false,     -- the one currency Stripe checkout actually charges in today
  rate_source              text NOT NULL DEFAULT 'manual' CHECK (rate_source IN ('manual', 'fetched')),
  rate_updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
-- Exactly one default currency at a time.
CREATE UNIQUE INDEX IF NOT EXISTS currencies_single_default
  ON public.currencies (is_default) WHERE is_default;

INSERT INTO public.currencies (code, symbol, name, exchange_rate_to_usd, is_active, is_default, rate_source)
VALUES ('USD', '$', 'US Dollar', 1, true, true, 'manual')
ON CONFLICT (code) DO NOTHING;

-- INR is seeded inactive (not the default, not yet chargeable) so a
-- self-hoster switching PAYMENT_GATEWAY to 'razorpay' (RazorPay settles in
-- INR) has a real exchange-rate row to edit in Settings -> Currency before
-- flipping the env var, rather than the RazorPay webhook hitting a missing
-- row. This rate is also the one used to convert RazorPay PAYG payments
-- (paise) into platform credits -- see supabase/functions/_shared/currency.ts.
INSERT INTO public.currencies (code, symbol, name, exchange_rate_to_usd, is_active, is_default, rate_source)
VALUES ('INR', '₹', 'Indian Rupee', 89, false, false, 'manual')
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS trg_currencies_updated ON public.currencies;
CREATE TRIGGER trg_currencies_updated BEFORE UPDATE ON public.currencies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS currencies_service_all ON public.currencies;
CREATE POLICY currencies_service_all ON public.currencies FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) mailer_config — singleton row (id = 'default'). Transactional-email
-- sender identity. `resend_api_key` is an OPTIONAL override of the
-- RESEND_API_KEY env var already used by /api/support — leave it null to
-- keep using the env var. The API route never echoes this value back to the
-- browser once saved (GET returns only resend_api_key_set: boolean); a PUT
-- with a blank/omitted key leaves the stored key untouched.
CREATE TABLE IF NOT EXISTS public.mailer_config (
  id                text PRIMARY KEY DEFAULT 'default',
  from_name         text,
  from_email        text,
  reply_to_email    text,
  resend_api_key    text,                                    -- nullable override; see comment above
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailer_config_singleton CHECK (id = 'default')
);
INSERT INTO public.mailer_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_mailer_config_updated ON public.mailer_config;
CREATE TRIGGER trg_mailer_config_updated BEFORE UPDATE ON public.mailer_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.mailer_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mailer_config_service_all ON public.mailer_config;
CREATE POLICY mailer_config_service_all ON public.mailer_config FOR ALL TO service_role USING (true) WITH CHECK (true);
