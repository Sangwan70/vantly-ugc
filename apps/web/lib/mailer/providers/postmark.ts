// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { MailerProvider, OutboundEmail, SendResult } from './types';

// Postmark's plain REST API (no SDK needed -- deliberately avoided adding
// a new npm dependency, see lib/mailer/sender-config.ts's own note on the
// pnpm workspace's install blocker). The batch endpoint accepts up to 500
// messages per call AND returns one result object per message (with its
// own ErrorCode/Message on failure) -- real per-recipient granularity in
// a single HTTP call, better than what Resend's batch API gives.
const POSTMARK_BATCH_URL = 'https://api.postmarkapp.com/email/batch';
const POSTMARK_BATCH_SIZE = 500;

interface PostmarkBatchResult {
  ErrorCode: number;
  Message: string;
  MessageID?: string;
  To?: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function createPostmarkProvider(serverToken: string): MailerProvider {
  return {
    name: 'postmark',
    async sendBatch(emails: OutboundEmail[]): Promise<SendResult[]> {
      const results: SendResult[] = [];
      for (const batch of chunk(emails, POSTMARK_BATCH_SIZE)) {
        const payload = batch.map((email) => ({
          From: email.from,
          To: email.to,
          ReplyTo: email.replyTo ?? undefined,
          Subject: email.subject,
          HtmlBody: email.html,
          TextBody: email.text ?? undefined,
          MessageStream: 'broadcast',
        }));

        try {
          const res = await fetch(POSTMARK_BATCH_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-Postmark-Server-Token': serverToken,
            },
            body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(json)) {
            const message = json && typeof json === 'object' && 'Message' in json
              ? String((json as { Message: unknown }).Message)
              : `Postmark batch request failed (HTTP ${res.status})`;
            for (const email of batch) results.push({ to: email.to, success: false, error: message });
            continue;
          }
          (json as PostmarkBatchResult[]).forEach((item, i) => {
            const to = batch[i]?.to ?? item.To ?? 'unknown';
            if (item.ErrorCode === 0) {
              results.push({ to, success: true, messageId: item.MessageID });
            } else {
              results.push({ to, success: false, error: item.Message || `Postmark error ${item.ErrorCode}` });
            }
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Postmark request failed';
          for (const email of batch) results.push({ to: email.to, success: false, error: message });
        }
      }
      return results;
    },
  };
}
