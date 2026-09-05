// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { Resend } from 'resend';
import { MailerProvider, OutboundEmail, SendResult, mapWithConcurrency } from './types';

// Resend's batch endpoint (resend.batch.send) is effectively all-or-
// nothing per HTTP call -- it doesn't return a per-recipient success/
// failure breakdown, which is exactly what email_logs (real per-
// recipient tracking, the Mailer audit's top-priority gap) needs. Sending
// one-at-a-time via resend.emails.send() costs more HTTP round trips but
// gives an honest per-recipient result. Concurrency-limited rather than
// fully parallel to stay well under Resend's rate limit.
const CONCURRENCY = 8;

export function createResendProvider(apiKey: string): MailerProvider {
  const resend = new Resend(apiKey);
  return {
    name: 'resend',
    async sendBatch(emails: OutboundEmail[]): Promise<SendResult[]> {
      return mapWithConcurrency(emails, CONCURRENCY, async (email): Promise<SendResult> => {
        try {
          const { data, error } = await resend.emails.send({
            from: email.from,
            to: email.to,
            replyTo: email.replyTo ?? undefined,
            subject: email.subject,
            html: email.html,
            text: email.text ?? undefined,
          });
          if (error) return { to: email.to, success: false, error: error.message };
          return { to: email.to, success: true, messageId: data?.id };
        } catch (e) {
          return { to: email.to, success: false, error: e instanceof Error ? e.message : 'Resend send failed' };
        }
      });
    },
  };
}
