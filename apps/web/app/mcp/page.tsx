// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'MCP Server — Vantly UGC',
  description: 'Generate AI UGC videos from Claude Code, Cursor, Windsurf, or any MCP-compatible client.',
};

const TOOLS: Array<{ name: string; desc: string }> = [
  { name: 'create_video', desc: 'Generate a UGC video from a script. Polls until complete, returns the video URL.' },
  { name: 'show_your_app', desc: 'Generate an actor holding a phone that shows your app screenshot.' },
  { name: 'product_acting_ugc', desc: 'Generate an actor presenting or reacting to a product image.' },
  { name: 'list_actors', desc: 'Browse available AI actors — slugs, names, demographics.' },
  { name: 'get_video_status', desc: "Check a generation job's status, video URL, or error message." },
];

export default function McpPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="vantly-ugc-mcp-server"
        title="UGC video generation for AI agents"
        lede="Script in, video URL out — directly from Claude Code, Cursor, Windsurf, or any MCP-compatible client."
      />

      <section className="mx-auto w-full max-w-3xl space-y-10 px-6 pb-24">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Tools
          </h2>
          <div className="mt-4 space-y-3">
            {TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="rounded-xl border px-5 py-4"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
              >
                <code className="text-sm font-semibold" style={{ color: 'var(--cryptix-purple)' }}>
                  {tool.name}
                </code>
                <p className="mt-1 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
                  {tool.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Setup — Claude Code
          </h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            Add to <code>~/.claude/settings.json</code>:
          </p>
          <div className="mt-4">
            <CodeBlock label="~/.claude/settings.json">{`{
  "mcpServers": {
    "vantly-ugc": {
      "command": "npx",
      "args": ["-y", "vantly-ugc-mcp-server"],
      "env": {
        "VANTLY_UGC_API_KEY": "ma_your_key_here"
      }
    }
  }
}`}</CodeBlock>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
            Setup — Cursor
          </h2>
          <p className="mt-3 text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            Open Settings → MCP Servers → Add Server:
          </p>
          <div className="mt-4">
            <CodeBlock label="cursor mcp config">{`{
  "vantly-ugc": {
    "command": "npx",
    "args": ["-y", "vantly-ugc-mcp-server"],
    "env": {
      "VANTLY_UGC_API_KEY": "ma_your_key_here"
    }
  }
}`}</CodeBlock>
          </div>
        </div>

        <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
          Sign up and generate an API key from your dashboard settings, then wire it
          into whichever client config above matches your setup. Prefer a terminal? See
          the{' '}
          <Link href="/cli" className="underline" style={{ color: 'var(--cryptix-purple)' }}>
            CLI
          </Link>
          .
        </p>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
