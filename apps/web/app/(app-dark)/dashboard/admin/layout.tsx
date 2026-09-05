// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/* shell.
 *
 * Previously rendered a persistent left sub-nav (Dashboard, Plans, Coupons,
 * Content, Blog Posts, Mailer, Settings) beside every admin page. Removed
 * per direct instruction: some sections -- especially the rebuilt Mailer
 * System (its own Templates/Campaigns/Groups/Landing Pages/Automated/
 * Branding/Sender Options panel) -- have their own full internal panel of
 * links, making a second, outer sidebar redundant chrome on every page. The
 * admin index (/dashboard/admin, see page.tsx) is now the hub that lists
 * every section's card so nothing that sidebar linked to becomes
 * unreachable; this layout instead renders just a slim "Back" link at the
 * top of each admin page -- back to the admin index from any section, or
 * back to the main dashboard from the index itself.
 *
 * Deliberately does NOT touch any existing admin page's own content or its
 * own auth gate: each admin page still performs its own isAdminEmailIn check
 * and renders its own "Not authorized" screen exactly as before. This layout
 * duplicates a lightweight version of that same check purely to decide
 * whether to show the Back link -- a non-admin who loads /dashboard/admin/*
 * sees precisely the same full-width "Not authorized" screen as before, no
 * behavior change from the pre-layout page.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { adminEmails } = useVariables();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
    })();
  }, [adminEmails]);

  if (!isAdmin) {
    // Each admin page performs its own full auth check and renders its own
    // "Not authorized" screen -- render children as-is, no Back link, so a
    // non-admin's experience is byte-for-byte what it was before this
    // layout existed.
    return <>{children}</>;
  }

  const atIndex = pathname === '/dashboard/admin';
  const backHref = atIndex ? '/dashboard' : '/dashboard/admin';
  const backLabel = atIndex ? 'Dashboard' : 'Admin';

  return (
    <div className="min-w-0">
      <div className="mx-auto w-full max-w-6xl px-8 pt-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-[12px] transition-opacity hover:opacity-80"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          <ArrowLeft className="h-3 w-3" /> {backLabel}
        </Link>
      </div>
      {children}
    </div>
  );
}
