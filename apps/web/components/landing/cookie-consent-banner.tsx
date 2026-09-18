// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Bottom-of-homepage disclaimer for the persistent auth session cookie
 * (see lib/supabase/cookie-options.ts / client.ts — @supabase/ssr already
 * sets that cookie with a 400-day Max-Age by default, which is what keeps
 * a signed-in visitor logged in after closing and reopening their
 * browser). This banner doesn't gate anything — the cookie is strictly
 * necessary for sign-in to work at all, so there's nothing to withhold by
 * declining — it's a plain disclosure with an acknowledge action, shown
 * once per device and then remembered.
 */

import { useEffect, useState } from 'react';

const CONSENT_KEY = 'vantly_cookie_notice_ack';

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      // Private-mode/blocked storage: fail open by just not showing the
      // banner rather than risking it reappearing on every navigation.
    }
  }, []);

  function accept() {
    setVisible(false);
    try {
      window.localStorage.setItem(CONSENT_KEY, '1');
    } catch {
      /* best-effort only */
    }
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div
        className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 rounded-2xl px-5 py-4 text-center shadow-2xl sm:flex-row sm:justify-between sm:text-left"
        style={{ background: 'var(--cryptix-surface)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
          We use a cookie to keep you signed in on this device, so you don&apos;t have to log in every time you close your browser. By continuing to use vantly-ugc, you accept this. See our{' '}
          <a href="/privacy" className="underline" style={{ color: 'var(--cryptix-text)' }}>Privacy Policy</a>.
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 rounded-full px-5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--cryptix-purple)', color: '#0F1015' }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
