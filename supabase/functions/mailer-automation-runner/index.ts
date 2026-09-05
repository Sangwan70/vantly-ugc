// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * mailer-automation-runner edge function -- pg_cron's tick target for the
 * Mailer System's scheduling + automated lifecycle triggers (registered
 * in 20260905130000_mailer_full_system.sql, every 15 minutes).
 *
 * Deliberately a THIN proxy, unlike schedule-runner (which does its DB
 * work directly in Deno against Supabase): the actual send pipeline --
 * resolve recipients, suppression filtering, per-recipient email_logs +
 * tracking, provider dispatch -- lives once, in this Next.js app's own
 * TypeScript (lib/mailer/send-campaign.ts, lib/mailer/
 * automated-triggers.ts), exercised by BOTH this cron path and the
 * admin's "Send Now" button. Re-implementing all of that a second time in
 * Deno would mean two copies of security-sensitive logic (the suppression
 * check especially) to keep in sync -- a worse risk than the one new
 * assumption this design makes: APP_PUBLIC_URL (the same env var
 * privacy/terms/contact pages already use as this instance's own public
 * URL) must be reachable from Supabase's Edge Functions network, which
 * it should be for any real deployment since it's this app's own
 * public-facing URL.
 *
 * Requires two Function secrets (`supabase secrets set ...`, see
 * deploy.sh): APP_PUBLIC_URL (this instance's own base URL) and
 * MAILER_CRON_SECRET (must match the Next.js app's own
 * MAILER_CRON_SECRET env var exactly -- this function is the only caller
 * of /api/internal/mailer/dispatch, which fails closed if either side's
 * secret is unset).
 */

const APP_PUBLIC_URL = Deno.env.get('APP_PUBLIC_URL') ?? '';
const MAILER_CRON_SECRET = Deno.env.get('MAILER_CRON_SECRET') ?? '';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (_req: Request) => {
  if (!APP_PUBLIC_URL || !MAILER_CRON_SECRET) {
    return jsonResp(500, { error: 'APP_PUBLIC_URL or MAILER_CRON_SECRET function secret is not set' });
  }

  try {
    const res = await fetch(`${APP_PUBLIC_URL.replace(/\/+$/, '')}/api/internal/mailer/dispatch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MAILER_CRON_SECRET}` },
    });
    const body = await res.json().catch(() => ({}));
    return jsonResp(res.status, body);
  } catch (e) {
    return jsonResp(502, { error: e instanceof Error ? e.message : 'Failed to reach the app' });
  }
});
