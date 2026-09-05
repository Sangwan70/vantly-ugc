// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Best-effort admin action audit trail for the Mailer System
 * (mailer_audit_log, see 20260905130000_mailer_full_system.sql). Called
 * from every mutating Mailer admin route -- template/campaign/group/
 * landing-page/trigger create-update-delete, sender config changes,
 * suppression add/remove, test sends. Never throws: a logging failure
 * must not turn an otherwise-successful admin action into a 500.
 *
 * Server-only.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface MailerAuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  /** e.g. 'template.create', 'campaign.send', 'suppression.add', 'sender.update'. */
  action: string;
  /** e.g. 'template', 'campaign', 'group', 'suppression', 'sender_config', 'landing_page', 'automated_trigger'. */
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logMailerAudit(entry: MailerAuditEntry): Promise<void> {
  try {
    const admin = adminClient();
    await admin.from('mailer_audit_log').insert({
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (e) {
    // Best-effort only -- see doc comment above.
    console.error('logMailerAudit: failed to write audit row', e);
  }
}
