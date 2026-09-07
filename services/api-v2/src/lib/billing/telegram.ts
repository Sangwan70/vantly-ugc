// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared Telegram notification helper for api-v2's billing routes, ported
 * from supabase/functions/_shared/telegram.ts (a Supabase Edge Function).
 *
 * Fire-and-forget: logs errors but never throws, so it cannot break
 * checkout/webhook flows. No-ops if env vars are missing.
 */

const TELEGRAM_API = 'https://api.telegram.org';

export async function notifyTelegram(message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    // Silently skip -- dev/staging environments won't have these set.
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text();
      console.error(`Telegram notification failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error('Telegram notification error:', err instanceof Error ? err.message : err);
  }
}
