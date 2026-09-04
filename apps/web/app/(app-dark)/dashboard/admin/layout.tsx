// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/* shell — adds a slim admin sub-nav (Dashboard, Settings,
 * …) to the left of admin pages.
 *
 * Deliberately does NOT touch any existing admin page's own content or its
 * own auth gate: each admin page still performs its own isAdminEmailIn check
 * and renders its own "Not authorized" screen exactly as before. This layout
 * duplicates a lightweight version of that same check purely to decide
 * whether to show the sub-nav chrome — a non-admin who loads /dashboard/admin/*
 * sees precisely the same full-width "Not authorized" screen as before, with
 * no sidebar, no behavior change from the pre-layout page.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings as SettingsIcon, CreditCard, Ticket, Mail, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';

const ADMIN_NAV = [
  { href: '/dashboard/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/admin/plans', label: 'Plans', icon: CreditCard },
  { href: '/dashboard/admin/coupons', label: 'Coupons', icon: Ticket },
  { href: '/dashboard/admin/content', label: 'Content', icon: FileText },
  { href: '/dashboard/admin/mailer', label: 'Mailer', icon: Mail },
  { href: '/dashboard/admin/settings', label: 'Settings', icon: SettingsIcon },
] as const;

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
    // "Not authorized" screen — render children as-is, no sidebar chrome, so
    // a non-admin's experience is byte-for-byte what it was before this
    // layout existed.
    return <>{children}</>;
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard/admin' && pathname.startsWith(href + '/'));

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-fit w-44 shrink-0 flex-col gap-1 py-10 pl-8 lg:flex">
        <p
          className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'rgba(255,255,255,0.32)' }}
        >
          Admin
        </p>
        {ADMIN_NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
              style={{
                color: active ? '#E9E9F0' : 'rgba(255,255,255,0.65)',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r"
                  style={{
                    background: 'linear-gradient(180deg,#A78BFA,#7C3AED)',
                    boxShadow: '0 0 10px rgba(167,139,250,0.5)',
                  }}
                />
              ) : null}
              <item.icon
                className="h-4 w-4 transition-colors group-hover:text-white"
                style={{ color: active ? '#A78BFA' : 'rgba(255,255,255,0.55)' }}
              />
              {item.label}
            </Link>
          );
        })}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
