// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'AI Workflows — Vantly UGC',
  description: 'Every AI agent and tool that can drive Vantly UGC — Claude, Claude Code, Cursor, Codex, ChatGPT, and more.',
};

type ToolEntry = {
  slug: string;
  title: string;
  iconUrl?: string;
  initials?: string;
  description: string;
  href: string;
};

const TOOLS: ToolEntry[] = [
  {
    slug: 'chatgpt',
    title: 'ChatGPT',
    iconUrl: '/agent-icons/openai-light.png',
    description: 'Describe the video you need and send the request into the Vantly UGC production flow.',
    href: '/ugc-video-api',
  },
  {
    slug: 'claude',
    title: 'Claude',
    iconUrl: '/agent-icons/claude.png',
    description: 'Ask for a video in plain language. Vantly UGC handles the production steps and returns the result.',
    href: '/mcp',
  },
  {
    slug: 'claude-code',
    title: 'Claude Code',
    iconUrl: '/agent-icons/claudecode.png',
    description: 'Turn release notes, product files, or repository context into launch videos without leaving your workflow.',
    href: '/mcp',
  },
  {
    slug: 'cursor',
    title: 'Cursor',
    initials: 'CU',
    description: 'Add the Vantly UGC MCP server to Cursor and generate videos straight from your editor.',
    href: '/mcp',
  },
  {
    slug: 'codex',
    title: 'Codex',
    iconUrl: '/agent-icons/codex.png',
    description: 'Drive Vantly UGC from Codex the same way you would any other MCP-compatible agent.',
    href: '/mcp',
  },
  {
    slug: 'openai-api',
    title: 'OpenAI API',
    initials: '{ }',
    description: 'Call the Vantly UGC HTTP API directly from an OpenAI-powered workflow or function call.',
    href: '/ugc-video-api',
  },
  {
    slug: 'openclaw',
    title: 'OpenClaw',
    initials: 'OC',
    description: 'Connect OpenClaw to the same MCP server used by Claude Code and Cursor.',
    href: '/mcp',
  },
  {
    slug: 'hermes-agent',
    title: 'Hermes Agent',
    initials: 'HA',
    description: 'Hermes Agent can call Vantly UGC over MCP or the plain HTTP API, whichever fits your setup.',
    href: '/mcp',
  },
];

export default function AiToolsPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="AI workflows"
        title="Drive it from any agent you already use"
        lede="Connect over MCP, CLI, or a plain HTTP API. If your agent can call a tool, it can generate UGC videos with Vantly UGC."
      />

      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.slug}
              id={tool.slug}
              href={tool.href}
              className="flex items-start gap-4 rounded-2xl border px-6 py-6 transition-colors hover:border-white/20"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--cryptix-surface-2)' }}
              >
                {tool.iconUrl ? (
                  <img src={tool.iconUrl} alt={tool.title} className="h-7 w-7 object-contain" />
                ) : (
                  <span className="text-sm font-semibold" style={{ color: 'var(--cryptix-purple)' }}>
                    {tool.initials}
                  </span>
                )}
              </div>
              <div>
                <p className="text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                  {tool.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                  {tool.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
