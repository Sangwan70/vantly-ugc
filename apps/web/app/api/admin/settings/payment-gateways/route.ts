// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import {
  getPaymentGatewaySettingsRow,
  resolveStripeCredentials,
  resolveRazorpayCredentials,
  resolvePaypalCredentials,
  type GatewayId,
} from '@/lib/billing/gateway-settings';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) return null;
  return user;
}

/**
 * Admin: read/write which payment gateway is selected in Settings ->
 * Payment Gateways, and each gateway's credentials.
 *
 * Same secret-handling convention as /api/admin/settings/mailer: a stored
 * secret (stripe_secret_key, razorpay_key_secret, paypal_client_secret)
 * never round-trips to the browser. GET returns only a `*_set` boolean plus
 * a `*_source` ('database' | 'env' | 'none') per credential. PUT only
 * touches a stored secret when a non-empty value is explicitly submitted
 * for it, or clears it when the matching `clear_*` flag is true -- every
 * other field (razorpay_key_id, paypal_client_id, paypal_mode) isn't a
 * secret by itself and is always safe to display/re-submit.
 *
 * This does NOT affect live checkout -- see the migration's header comment
 * for why. It drives only the admin Plans-minting surface
 * (gateway-admin.ts / plan-gateway-sync.ts).
 */
export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const admin = adminClient();
  let row;
  try {
    row = await getPaymentGatewaySettingsRow(admin);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load settings' }, { status: 500 });
  }

  const stripe = resolveStripeCredentials(row);
  const razorpay = resolveRazorpayCredentials(row);
  const paypal = resolvePaypalCredentials(row);

  return NextResponse.json({
    settings: {
      active_gateway: row.active_gateway,
      updated_at: row.updated_at,

      stripe_secret_key_set: !!row.stripe_secret_key?.trim(),
      stripe_secret_key_source: stripe.source,

      razorpay_key_id: row.razorpay_key_id,
      razorpay_key_secret_set: !!row.razorpay_key_secret?.trim(),
      razorpay_source: razorpay.source,

      paypal_client_id: row.paypal_client_id,
      paypal_client_secret_set: !!row.paypal_client_secret?.trim(),
      paypal_mode: row.paypal_mode,
      paypal_source: paypal.source,
    },
  });
}

interface Body {
  active_gateway?: unknown;
  stripe_secret_key?: unknown;
  clear_stripe_secret_key?: unknown;
  razorpay_key_id?: unknown;
  razorpay_key_secret?: unknown;
  clear_razorpay_key_secret?: unknown;
  paypal_client_id?: unknown;
  paypal_client_secret?: unknown;
  clear_paypal_client_secret?: unknown;
  paypal_mode?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

const VALID_GATEWAYS: readonly GatewayId[] = ['stripe', 'razorpay', 'paypal'];

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const activeGateway = typeof body.active_gateway === 'string' ? body.active_gateway : undefined;
  if (activeGateway !== undefined && !VALID_GATEWAYS.includes(activeGateway as GatewayId)) {
    return NextResponse.json({ error: `active_gateway must be one of: ${VALID_GATEWAYS.join(', ')}` }, { status: 400 });
  }

  const paypalMode = typeof body.paypal_mode === 'string' ? body.paypal_mode : undefined;
  if (paypalMode !== undefined && paypalMode !== 'live' && paypalMode !== 'sandbox') {
    return NextResponse.json({ error: 'paypal_mode must be "live" or "sandbox"' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    id: 'default',
    razorpay_key_id: str(body.razorpay_key_id),
    paypal_client_id: str(body.paypal_client_id),
    updated_by: user.id,
  };
  if (activeGateway !== undefined) patch.active_gateway = activeGateway;
  if (paypalMode !== undefined) patch.paypal_mode = paypalMode;

  // Each secret: only touch when a non-empty value is submitted, or clear
  // when explicitly asked to -- otherwise leave the stored value alone.
  const secretFields: [string, unknown, unknown][] = [
    ['stripe_secret_key', body.stripe_secret_key, body.clear_stripe_secret_key],
    ['razorpay_key_secret', body.razorpay_key_secret, body.clear_razorpay_key_secret],
    ['paypal_client_secret', body.paypal_client_secret, body.clear_paypal_client_secret],
  ];
  for (const [field, value, clearFlag] of secretFields) {
    const s = str(value);
    if (s) patch[field] = s;
    else if (clearFlag === true) patch[field] = null;
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from('payment_gateway_settings')
    .upsert(patch, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data as Awaited<ReturnType<typeof getPaymentGatewaySettingsRow>>;
  const stripe = resolveStripeCredentials(row);
  const razorpay = resolveRazorpayCredentials(row);
  const paypal = resolvePaypalCredentials(row);

  return NextResponse.json({
    settings: {
      active_gateway: row.active_gateway,
      updated_at: row.updated_at,
      stripe_secret_key_set: !!row.stripe_secret_key?.trim(),
      stripe_secret_key_source: stripe.source,
      razorpay_key_id: row.razorpay_key_id,
      razorpay_key_secret_set: !!row.razorpay_key_secret?.trim(),
      razorpay_source: razorpay.source,
      paypal_client_id: row.paypal_client_id,
      paypal_client_secret_set: !!row.paypal_client_secret?.trim(),
      paypal_mode: row.paypal_mode,
      paypal_source: paypal.source,
    },
  });
}
