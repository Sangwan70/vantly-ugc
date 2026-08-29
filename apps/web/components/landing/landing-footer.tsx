'use client';

import Link from 'next/link';
import { siGithub, siDiscord, siX, siYoutube } from 'simple-icons';

const PRODUCT_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/best', label: 'Best UGC Tools' },
  { href: '/showcase', label: 'Showcase' },
  { href: '/skill-center', label: 'Skill Center' },
  { href: '/use-cases', label: 'Use Cases' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/how-to', label: 'UGC Guides' },
  { href: '/blog', label: 'Blog' },
];

const AI_WORKFLOW_LINKS = [
  { href: '/ai-tools#claude', label: 'Claude' },
  { href: '/ai-tools#claude-code', label: 'Claude Code' },
  { href: '/ai-tools#cursor', label: 'Cursor' },
  { href: '/ai-tools#codex', label: 'Codex' },
  { href: '/ai-tools#chatgpt', label: 'ChatGPT' },
  { href: '/ai-tools#openai-api', label: 'OpenAI API' },
  { href: '/ai-tools#openclaw', label: 'OpenClaw' },
  { href: '/ai-tools#hermes-agent', label: 'Hermes Agent' },
];

const DEVELOPER_LINKS = [
  { href: '/developers', label: 'Developer Hub' },
  { href: '/docs/api-reference', label: 'API Reference' },
  { href: '/cli', label: 'CLI on npm' },
  { href: '/mcp', label: 'MCP Server' },
  { href: '/sdk/typescript', label: 'TypeScript SDK' },
  { href: '/sdk/python', label: 'Python SDK' },
  { href: '/openapi.json', label: 'OpenAPI Spec' },
  { href: 'https://github.com/gitroomhq/agent-media-app', label: 'GitHub' },
];

const SOCIAL_LINKS = [
  { href: 'https://github.com/gitroomhq/agent-media-app', label: 'GitHub', icon: siGithub },
  { href: 'https://discord.gg', label: 'Discord', icon: siDiscord },
  { href: 'https://x.com', label: 'X', icon: siX },
  { href: 'https://youtube.com', label: 'YouTube', icon: siYoutube },
];

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-[0.2em]"
        style={{ color: 'var(--cryptix-text-muted)' }}
      >
        {title}
      </p>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm transition-colors hover:opacity-100"
              style={{ color: 'var(--cryptix-text-muted)', opacity: 0.85 }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="relative mx-auto w-full max-w-6xl border-t px-6 py-16"
      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
        <FooterColumn title="Product" links={PRODUCT_LINKS} />
        <FooterColumn title="AI Workflows" links={AI_WORKFLOW_LINKS} />
        <FooterColumn title="Developers" links={DEVELOPER_LINKS} />
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: 'var(--cryptix-text-muted)' }}
          >
            Legal
          </p>
          <ul className="mt-4 space-y-3">
            <li>
              <Link
                href="/privacy"
                className="text-sm"
                style={{ color: 'var(--cryptix-text-muted)', opacity: 0.85 }}
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="text-sm"
                style={{ color: 'var(--cryptix-text-muted)', opacity: 0.85 }}
              >
                Terms of Service
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div
        className="mt-14 flex flex-col items-center justify-between gap-6 border-t pt-8 sm:flex-row"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          © {year} Vantly UGC. All rights reserved.
        </p>
        <div className="flex items-center gap-4">
          {SOCIAL_LINKS.map((social) =>
            social.icon ? (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={social.label}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                style={{ background: 'var(--cryptix-surface)' }}
              >
                <svg
                  role="img"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  style={{ fill: 'var(--cryptix-text-muted)' }}
                >
                  <path d={social.icon.path} />
                </svg>
              </a>
            ) : null
          )}
        </div>
      </div>
    </footer>
  );
}
