// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import Link from 'next/link';
import type { ComponentType, MouseEvent, ReactNode } from 'react';
import { useState } from 'react';
import {
  BookOpenText,
  Bot,
  ChevronDown,
  Code2,
  Github,
  Images,
  Menu,
  Newspaper,
  Plug,
  Terminal,
  Webhook,
  X,
} from 'lucide-react';
import { useLogin } from '@/components/login-context';
import { Home2CTAButton } from '@/components/home2-cta-button';

const primaryLinks = [
  { href: '/use-cases', label: 'Use Cases' },
  { href: '/best', label: 'Best UGC Tools' },
  { href: '/pricing', label: 'Pricing' },
];

const developerLinks = [
  {
    href: '/developers',
    label: 'Developer Hub',
    description: 'API, CLI, SDK, and MCP workflows',
    icon: Code2,
  },
  {
    href: '/ugc-video-api',
    label: 'UGC Video API',
    description: 'REST API for AI UGC ad generation',
    icon: Webhook,
  },
  {
    href: '/cli',
    label: 'CLI',
    description: '30 commands. npm install -g vantly-ugc-cli',
    icon: Terminal,
  },
  {
    href: '/sdk/typescript',
    label: 'TypeScript SDK',
    description: 'Typed Node.js client on npm',
    icon: Code2,
  },
  {
    href: '/sdk/python',
    label: 'Python SDK',
    description: 'Sync + async client on PyPI',
    icon: Code2,
  },
  {
    href: '/mcp',
    label: 'MCP Server',
    description: 'For Claude Code, Cursor, Windsurf',
    icon: Bot,
  },
  {
    href: '/ai-tools',
    label: 'AI Workflows',
    description: 'Claude, Claude Code, Cursor, Codex, and more',
    icon: Plug,
  },
  {
    href: '/docs/api-reference',
    label: 'API Docs',
    description: 'Endpoints and implementation examples',
    icon: BookOpenText,
  },
  {
    href: 'https://github.com/gitroomhq/agent-media-app',
    label: 'GitHub',
    description: 'Public repo and package source',
    icon: Github,
    external: true,
  },
];

const resourceLinks = [
  {
    href: '/how-to',
    label: 'UGC Guides',
    description: 'How to make every UGC format with AI',
    icon: Images,
  },
  {
    href: '/showcase',
    label: 'Showcase',
    description: 'Real renders from the pipeline',
    icon: Images,
  },
  {
    href: '/skill-center',
    label: 'Skill Center',
    description: 'Every generation skill in the registry',
    icon: Bot,
  },
  {
    href: '/blog',
    label: 'Blog',
    description: 'Notes from the team',
    icon: Newspaper,
  },
];

const mobileLinkGroups = [
  {
    label: 'Product',
    links: [
      ...primaryLinks,
      { href: '/how-to', label: 'UGC Guides' },
      { href: '/showcase', label: 'Showcase' },
      { href: '/skill-center', label: 'Skill Center' },
      { href: '/blog', label: 'Blog' },
    ],
  },
  {
    label: 'Developers',
    links: developerLinks.map(({ href, label, external }) => ({ href, label, external })),
  },
  {
    label: 'Resources',
    links: [
      { href: '/docs/api-reference', label: 'API Docs' },
      { href: '/docs/api-changelog', label: 'Changelog' },
    ],
  },
];

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm text-white/65 transition-colors hover:text-white">
      {children}
    </Link>
  );
}

function NavMenu({
  label,
  links,
  align = 'left',
}: {
  label: string;
  links: Array<{
    href: string;
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    external?: boolean;
  }>;
  align?: 'left' | 'right';
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-white/65 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
      </button>
      <div
        className={`pointer-events-none absolute top-full pt-4 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        <div className="w-[310px] rounded-2xl border border-white/10 bg-[#17181f] p-2 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
          {links.map(({ href, label: itemLabel, description, icon: Icon, external }) => {
            const className =
              'flex gap-3 rounded-xl p-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none';
            const content = (
              <>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{itemLabel}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-white/55">
                    {description}
                  </span>
                </span>
              </>
            );

            if (external) {
              return (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {content}
                </a>
              );
            }

            return (
              <Link key={href} href={href} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function LandingHeader() {
  const { openLogin } = useLogin();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  function handleGenerateClick(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    openLogin();
  }

  return (
    <header className="sticky top-3 z-50 mx-4 max-w-[1200px] rounded-full border border-white/10 bg-[rgba(13,14,18,0.55)] px-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:top-4 sm:mx-6 sm:px-6 lg:mx-auto lg:w-full">
      <div className="flex h-[52px] items-center justify-between sm:h-14">
        <div className="flex min-w-0 items-center gap-4 lg:gap-8">
          <Link
            href="/"
            className="whitespace-nowrap text-lg font-bold tracking-tight text-white"
          >
            vantly-ugc
          </Link>
          <nav className="hidden items-center gap-6 xl:flex">
            {primaryLinks.map((link) => (
              <NavLink key={link.href} href={link.href}>
                {link.label}
              </NavLink>
            ))}
            <NavMenu label="Developers" links={developerLinks} />
            <NavMenu label="Resources" links={resourceLinks} align="right" />
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div onClick={handleGenerateClick}>
            <Home2CTAButton href="#" variant="dark" size="md" showArrow={false}>
              <span className="sm:hidden">Generate</span>
              <span className="hidden sm:inline">Start generating</span>
            </Home2CTAButton>
          </div>
          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 xl:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileMenuOpen && (
        <nav className="absolute inset-x-0 top-[calc(100%+8px)] max-h-[calc(100vh-88px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0D0E12] p-3 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl xl:hidden">
          <div className="grid gap-2 sm:grid-cols-3">
            {mobileLinkGroups.map((group) => (
              <div key={group.label} className="rounded-xl bg-white/5 p-2">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
                  {group.label}
                </p>
                <div className="grid gap-1">
                  {group.links.map((link) => {
                    const className =
                      'block rounded-lg px-2 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none';

                    if ('external' in link && link.external) {
                      return (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={className}
                          onClick={closeMobileMenu}
                        >
                          {link.label}
                        </a>
                      );
                    }

                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={className}
                        onClick={closeMobileMenu}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
