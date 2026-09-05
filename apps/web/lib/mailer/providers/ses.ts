// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { createHash, createHmac } from 'crypto';
import { MailerProvider, OutboundEmail, SendResult, mapWithConcurrency } from './types';

/**
 * AWS SES v2 (SendEmail), signed by hand with AWS Signature Version 4 --
 * no @aws-sdk/* package, same "avoid a new npm dependency while the pnpm
 * workspace's install is blocked" reasoning as postmark.ts. SigV4 is a
 * well-specified, deterministic algorithm (not provider-specific
 * guesswork), implemented here exactly per AWS's published steps
 * (canonical request -> string to sign -> derived signing key ->
 * signature). This has NOT been exercised against a live AWS endpoint in
 * this environment (no credentials, no way to send real test mail here)
 * -- unlike Resend/Postmark, which this session's own tests can only
 * reach the same way (no live send either), a signature-algorithm bug
 * specifically would surface as every single SES send failing with an
 * auth error, not a partial/subtle failure -- so it fails LOUD and
 * immediately rather than silently, and the admin's own Settings ->
 * Mailer "send a test email" action is the first real-world check before
 * any campaign relies on this path.
 */
const CONCURRENCY = 8;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function amzDateNow(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString(); // e.g. 2026-09-05T13:00:00.000Z
  const amzDate = iso.replace(/[:-]|\.\d{3}/g, ''); // 20260905T130000Z
  const dateStamp = amzDate.slice(0, 8);
  return { amzDate, dateStamp };
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

interface SesCreds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

async function sesRequest(
  creds: SesCreds,
  path: string,
  bodyObj: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const service = 'ses';
  const host = `email.${creds.region}.amazonaws.com`;
  const method = 'POST';
  const { amzDate, dateStamp } = amzDateNow();
  const body = JSON.stringify(bodyObj);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const key = signingKey(creds.secretAccessKey, dateStamp, creds.region, service);
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: authorization,
    },
    body,
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export function createSesProvider(creds: SesCreds): MailerProvider {
  return {
    name: 'ses',
    async sendBatch(emails: OutboundEmail[]): Promise<SendResult[]> {
      return mapWithConcurrency(emails, CONCURRENCY, async (email): Promise<SendResult> => {
        try {
          const { ok, status, json } = await sesRequest(creds, '/v2/email/outbound-emails', {
            FromEmailAddress: email.from,
            Destination: { ToAddresses: [email.to] },
            ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: 'UTF-8' },
                Body: {
                  Html: { Data: email.html, Charset: 'UTF-8' },
                  ...(email.text ? { Text: { Data: email.text, Charset: 'UTF-8' } } : {}),
                },
              },
            },
          });
          if (!ok) {
            const message =
              json && typeof json === 'object' && 'message' in json
                ? String((json as { message: unknown }).message)
                : `SES request failed (HTTP ${status})`;
            return { to: email.to, success: false, error: message };
          }
          const messageId =
            json && typeof json === 'object' && 'MessageId' in json ? String((json as { MessageId: unknown }).MessageId) : undefined;
          return { to: email.to, success: true, messageId };
        } catch (e) {
          return { to: email.to, success: false, error: e instanceof Error ? e.message : 'SES request failed' };
        }
      });
    },
  };
}
