// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Shared section nav for every /dashboard/admin/mailer/* page -- keeps
 * Templates/Groups/Campaigns/Landing Pages/Automated/Audit Log (plus
 * Settings, which lives outside this route tree) all one click apart
 * instead of each sub-page only linking to one or two neighbors. Same
 * separate-pages structure the Mailer milestone already established
 * (Templates page linking to Groups/Campaigns) -- this just extends it
 * to the sub-pages added afterward and makes it consistent everywhere.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Users2, Megaphone, Link2, Zap, ScrollText, Settings } from 'lucide-react';

const SECTIONS = [
  { href: '/dashboard/admin/mailer', label: 'Templates', icon: FileText },
  { href: '/dashboard/admin/mailer/groups', label: 'Groups', icon: Users2 },
  { href: '/dashboard/admin/mailer/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/dashboard/admin/mailer/landing-pages', label: 'Landing Pages', icon: Link2 },
  { href: '/dashboard/admin/mailer/automated', label: 'Automated', icon: Zap },
  { href: '/dashboard/admin/mailer/audit-log', label: 'Audit Log', icon: ScrollText },
  { href: '/dashboard/admin/settings?tab=mailer', label: 'Sender & Branding', icon: Settings },
] as const;

export function MailerNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {SECTIONS.map((s) => {
        const active = s.href.startsWith('/dashboard/admin/mailer') ? pathname === s.href : false;
        const Icon = s.icon;
        return (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]"
            style={active
              ? { background: 'rgba(167,139,250,0.15)', color: '#C4B5FD', border: '1px solid rgba(167,139,250,0.3)' }
              : { background: '#1B1C2A', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Icon className="h-3 w-3" /> {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
