// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { EffectiveSenderConfig } from '../sender-config';
import { MailerProvider } from './types';
import { createResendProvider } from './resend';
import { createPostmarkProvider } from './postmark';
import { createSesProvider } from './ses';

export type { MailerProvider, OutboundEmail, SendResult } from './types';

/**
 * Builds the actual sender for whatever provider mailer_config currently
 * selects. Throws a plain Error with a message safe to surface directly
 * to an admin (never leaks a credential) -- callers should catch this and
 * turn it into a 503-style "email not configured" response, same as the
 * existing !sender.apiKey check this replaces.
 */
export function getProviderSender(sender: EffectiveSenderConfig): MailerProvider {
  switch (sender.provider) {
    case 'resend':
      if (!sender.resendApiKey) throw new Error('Resend is selected but no API key is configured (Settings -> Mailer).');
      return createResendProvider(sender.resendApiKey);
    case 'postmark':
      if (!sender.postmarkApiKey) throw new Error('Postmark is selected but no server token is configured (Settings -> Mailer).');
      return createPostmarkProvider(sender.postmarkApiKey);
    case 'ses':
      if (!sender.sesAccessKeyId || !sender.sesSecretAccessKey || !sender.sesRegion) {
        throw new Error('Amazon SES is selected but access key / secret / region are not fully configured (Settings -> Mailer).');
      }
      return createSesProvider({ accessKeyId: sender.sesAccessKeyId, secretAccessKey: sender.sesSecretAccessKey, region: sender.sesRegion });
    case 'smtp':
      // Deliberately unimplemented -- see types.ts's doc comment. The DB
      // still allows selecting it (so a future real implementation needs
      // no migration), but sending with it fails clearly instead of
      // silently no-opping or falling back to another provider.
      throw new Error('SMTP sending is not yet implemented in this build. Choose Resend, Postmark, or Amazon SES in Settings -> Mailer.');
    default:
      throw new Error(`Unknown mailer provider: ${sender.provider}`);
  }
}
