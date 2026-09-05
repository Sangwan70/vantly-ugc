// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Provider-agnostic sending contract, shared by resend.ts / postmark.ts /
 * ses.ts. Every provider gets the SAME html per recipient it's handed --
 * per-recipient personalization (variable substitution, the tracking
 * pixel/link rewriting) happens one layer up, before this is called, so
 * every provider implementation only has to worry about actually
 * delivering an already-finished email.
 *
 * SMTP is deliberately NOT implemented -- there's no SMTP client library
 * in this project, and hand-rolling STARTTLS/AUTH/DATA with no way to
 * send live test mail in this environment was judged too risky for
 * production email (see lib/mailer/sender-config.ts's provider list).
 * `mailer_config.provider` still allows the value in the DB (so choosing
 * it doesn't need a future migration) but getProviderSender() below
 * throws a clear, caught error rather than attempting to send.
 */

export interface OutboundEmail {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text?: string | null;
}

export interface SendResult {
  to: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MailerProvider {
  name: 'resend' | 'postmark' | 'ses';
  sendBatch(emails: OutboundEmail[]): Promise<SendResult[]>;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once --
 * shared by every provider that has to send one HTTP request per
 * recipient (Resend, SES), so a large campaign doesn't fire hundreds of
 * concurrent requests at once and trip the provider's own rate limiting.
 * Postmark's real batch endpoint doesn't need this (one HTTP call for up
 * to 500 recipients).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
