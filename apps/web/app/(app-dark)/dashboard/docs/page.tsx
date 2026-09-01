// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/docs — internal Skills & MCP guide.
 *
 * Reuses the exact public Skills & CLI hub content (ConnectGuide + live skills
 * grid + REST snippet) so there's a single source of truth for "how to connect
 * vantly-ugc". `internal` keeps it self-contained: the MCP/CLI/Skill tabs
 * switch via state only and never push the public /mcp /cli /skills URLs that
 * would bounce the signed-in user out to the marketing site.
 *
 * A "Sample prompts" section (copyable, full example requests for each video
 * type) sits above the connect guide — kept out of SkillsHub itself since
 * that component is also rendered on the public marketing /skills /mcp /cli
 * pages, where a signed-out visitor can't act on an Agent-chat prompt anyway.
 */

import { SkillsHub } from '@/components/skills-hub';
import { SamplePrompts } from '@/components/sample-prompts';

export default function DocsPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-6 pt-16 sm:pt-20">
        <SamplePrompts />
      </div>
      <SkillsHub initialTab="mcp" internal />
    </>
  );
}
