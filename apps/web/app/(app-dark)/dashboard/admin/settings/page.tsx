// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/settings — platform-wide admin configuration, gated to
 * the same allowlist as /dashboard/admin (lib/admin-allowlist.ts). Tabbed:
 * General (site branding/SEO), Currency (multi-currency charging config —
 * the settings foundation a future Plans feature will read from), and
 * Mailer (transactional-email sender identity). Adding a further tab later
 * is a one-line addition to TABS plus one new _*-tab.tsx component.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { GeneralTab } from './_general-tab';
import { CurrencyTab } from './_currency-tab';
import { MailerTab } from './_mailer-tab';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'currency', label: 'Currency' },
  { key: 'mailer', label: 'Mailer' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function isTabKey(v: string | null): v is TabKey {
  return TABS.some((t) => t.key === v);
}

/** Wrapped in Suspense below -- useSearchParams requires it to avoid de-opting the whole page from static rendering. Only used to let links like MailerNav's "Sender & Branding" open straight to a tab via ?tab=. */
function AdminSettingsPageInner() {
  const { adminEmails } = useVariables();
  const searchParams = useSearchParams();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : 'general');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  if (!authChecked) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-8 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Not authorized</h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>This area is restricted to vantly-ugc admins.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Settings</h1>

      <div className="mt-6 flex gap-1 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="relative px-4 py-2.5 text-sm font-medium transition-colors"
              style={{ color: active ? '#E9E9F0' : 'rgba(255,255,255,0.5)' }}
            >
              {t.label}
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-px h-[2px] rounded-full"
                  style={{ background: 'linear-gradient(90deg,#A78BFA,#7C3AED)' }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === 'general' ? <GeneralTab /> : null}
        {tab === 'currency' ? <CurrencyTab /> : null}
        {tab === 'mailer' ? <MailerTab /> : null}
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>}>
      <AdminSettingsPageInner />
    </Suspense>
  );
}
