// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /logout -- a small, no-UI-to-speak-of page that signs the current
 * session out and sends the browser back to the marketing site.
 *
 * Exists because the marketing homepage's header "Logout" link (shown
 * once hasSessionHint() says a session exists -- see lib/marketing.ts)
 * can't call supabase.auth.signOut() itself: it renders on the marketing
 * host, which never holds the real Supabase session cookie (that's
 * scoped to THIS app host). So it's a plain link to this page instead,
 * which runs on the host that actually has something to sign out of.
 *
 * Same signOut() + goToMarketingSite() pair every other "Log out" control
 * in the app already uses (see components/user-menu.tsx and the (auth)/
 * (app-dark) layouts) -- goToMarketingSite() also clears the cross-domain
 * session hint, so the marketing header flips back to signed-out
 * immediately rather than showing a stale "Dashboard"/"Logout" pair.
 */

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { goToMarketingSite } from '@/lib/marketing';

export default function LogoutPage() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      if (!cancelled) goToMarketingSite();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#ededed]">
      <div className="flex items-center gap-2 text-sm text-[#6b6b76]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Signing out…
      </div>
    </div>
  );
}
