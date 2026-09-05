// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/admin/mailer/audit-log -- read-only viewer for mailer_audit_log. */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Search } from 'lucide-react';
import { MailerNav } from '@/components/admin/mailer-nav';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

export default function AdminMailerAuditLogPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async (action: string) => {
    try {
      const r = await fetch(`/api/admin/mailer/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`, { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setEntries([]); return; }
      if (!r.ok) { setError(`audit log ${r.status}`); setEntries([]); return; }
      const j = await r.json();
      setEntries(j.entries ?? []);
    } catch (e) { setError((e as Error).message); setEntries([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(query); }, [isAdmin, load, query]);

  if (!authChecked) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-8 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Not authorized</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <MailerNav />
      <h1 className="mt-3 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Audit log</h1>
      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Every mutating Mailer admin action -- sends, sender/settings changes, suppressions, template/campaign/group/landing-page/trigger edits. Most recent 100 shown.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Search className="h-3.5 w-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by action (e.g. campaign.send)"
          className="w-72 rounded-lg px-2.5 py-1.5 text-[13px]"
          style={INPUT}
        />
      </div>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {entries === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No matching audit entries.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" style={{ color: '#E9E9F0' }}>{e.action}</span>
                  {e.target_type ? <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {e.target_type}{e.target_id ? ` #${e.target_id.slice(0, 8)}` : ''}</span> : null}
                  <span className="ml-auto" style={{ color: 'rgba(255,255,255,0.4)' }}>{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {e.actor_email ?? 'system'}
                  {Object.keys(e.metadata ?? {}).length > 0 ? ` · ${Object.entries(e.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
