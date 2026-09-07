// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/skills/[slug] — focused per-skill page.
 *
 * Left column: form + active run for THIS skill (polled).
 * Right column: MCP / REST / CLI install snippets.
 * Bottom: recent runs of this skill (filtered via /v1/me/gallery).
 *
 * The form + active-run card (RunPanel) live in ../_run-panel.tsx, shared
 * with the agent page's "Run a skill" composer option so both surfaces
 * submit/poll runs identically.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { use } from 'react';
import { Loader2, ArrowLeft, ExternalLink, Copy, Check } from 'lucide-react';
import { metaFor } from '../_meta';
import { FORMS } from '../_forms';
import { RunPanel, type SkillEntry, type RunResult } from '../_run-panel';

interface RecentItem {
  id: string;
  source: string;
  primitive: string | null;
  status: string;
  created_at: string;
  media_url: string | null;
  thumbnail_url: string | null;
}

const TERMINAL = new Set(['succeeded', 'completed', 'success', 'failed', 'canceled', 'cancelled']);

// Unifies a direct skill-page run into the single agent feed (task: "one
// interface for both Generate and see Generations"). A run launched HERE
// (bypassing the agent's chat brain entirely) gets its own new agent chat —
// titled from the skill + timestamp — so it shows up on /dashboard/agent
// exactly like a run the brain triggered: an assistant tool_use message at
// submit time, then a matching tool_result once the run finishes. Uses the
// same /v1/agent/chats(+/:id/messages) endpoints and message shape the agent
// page's own persist()/toServerMessage() write (see dashboard/agent/page.tsx)
// so both surfaces render identically via the agent page's rebuildToolRuns().
//
// Best-effort: if any of this fails, the run itself is unaffected — the user
// just won't see it listed on the agent page. Errors are swallowed rather
// than surfaced, since this is a background convenience, not the primary
// action the user asked for.
async function createRunAgentChat(skill: SkillEntry, toolUseId: string, run: RunResult): Promise<string | null> {
  try {
    const title = `Run ${skill.name} — ${new Date().toLocaleString()}`;
    // Embeds the run's real id (+ composed-ness) directly in the tool_use
    // block's own `input` — the one thing this message carries that
    // survives regardless of whether THIS tab is still open. Without it,
    // a run that outlives the tab (make_storybook alone runs 6-25 min,
    // per _meta.ts) has no way to be resumed later: the agent page's
    // rebuildToolRuns()/resumeIfNeeded() previously only ever learned a
    // run's id from its tool_result message, which is exactly the
    // message this page never gets to post if the user navigates away
    // first — the run would sit orphaned forever, "generating…" with no
    // way to finish. `standalone: true` tells the agent page not to hand
    // the resumed result to the chat brain (driveLoop) once it resumes —
    // this chat has no brain conversation, only this one run.
    const firstMessage = {
      role: 'assistant' as const,
      content: [{
        type: 'tool_use', id: toolUseId, name: skill.slug,
        input: { run_id: run.id, composed: run.composed, standalone: true },
      }],
      client_msg_id: toolUseId,
    };
    const r = await fetch('/api/v1/agent/chats', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, first_message: firstMessage }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: string };
    return j.id ?? null;
  } catch {
    return null;
  }
}

async function postRunResultToAgentChat(
  chatId: string,
  toolUseId: string,
  run: RunResult,
): Promise<void> {
  const failed = run.status === 'failed' || run.status === 'error';
  let content: string;
  if (failed) {
    content = JSON.stringify({ status: 'failed', error: run.error?.message ?? run.error ?? run.status });
  } else if (run.composed) {
    const out = (run.final_output ?? {}) as Record<string, unknown>;
    content = JSON.stringify({ status: 'succeeded', video_url: out.video_url ?? null, final_output: run.final_output ?? null });
  } else {
    const artifacts = run.artifacts ?? [];
    const videoUrl = artifacts.find((a) => /\.(mp4|webm|mov)(\?|$)/i.test(a.url ?? ''))?.url ?? artifacts[0]?.url ?? null;
    content = JSON.stringify({ status: 'succeeded', video_url: videoUrl, artifact_urls: artifacts.map((a) => a.url).filter(Boolean) });
  }
  try {
    await fetch(`/api/v1/agent/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
          client_msg_id: toolUseId,
          skill_run_id: run.id,
          run_kind: run.composed ? 'skill' : 'primitive',
        }],
      }),
    });
  } catch { /* best-effort — see comment above */ }
}

export default function SkillDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [skill, setSkill] = useState<SkillEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [activeRun, setActiveRun] = useState<RunResult | null>(null);
  // Tracks the agent chat + tool_use id created for each run this page has
  // launched, keyed by run id, so the poll effect's terminal tick knows where
  // to post the matching tool_result (see createRunAgentChat above). A ref,
  // not state — purely a hand-off between two callbacks, never rendered.
  const agentLinkRef = useRef<Record<string, { chatId: string; toolUseId: string }>>({});
  const linkedResultRef = useRef<Set<string>>(new Set());

  // Load skill metadata
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/skills', { credentials: 'include' });
        if (!r.ok) { setError(`skills ${r.status}`); return; }
        const j = (await r.json()) as { skills: SkillEntry[] };
        const found = j.skills.find((s) => s.slug === slug);
        if (!found) { setError(`Skill "${slug}" not found`); return; }
        setSkill(found);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [slug]);

  // Load recent runs for this skill
  const reloadRecent = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '10', skill: slug, primitive: slug });
      const r = await fetch(`/api/v1/me/gallery?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { items?: RecentItem[] };
      // For composed skill, we want the skill-run rows (source=vnext_skill).
      // For primitives, we want primitive-run rows (source=vnext_primitive).
      const filtered = (j.items ?? []).filter((it) => it.primitive === slug);
      setRecent(filtered);
    } catch { /* ignore */ }
  }, [slug]);
  useEffect(() => { void reloadRecent(); }, [reloadRecent]);

  // Poll active run
  useEffect(() => {
    if (!activeRun || TERMINAL.has(activeRun.status)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const url = activeRun.composed
          ? `/api/v1/skills/runs/${encodeURIComponent(activeRun.id)}`
          : `/api/v1/primitives/runs/${encodeURIComponent(activeRun.id)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (r.ok) {
          const d = (await r.json()) as any;
          const next: RunResult = activeRun.composed
            ? { composed: true, id: d.skill_run_id ?? activeRun.id, status: d.status ?? '?', current_step: d.current_step ?? null, steps: d.steps ?? [], final_output: d.final_output ?? null, error: d.error ?? null }
            : { composed: false, id: d.run_id ?? activeRun.id, status: d.status ?? '?', artifacts: d.artifacts ?? [], error: d.error ?? null };
          setActiveRun(next);
          if (TERMINAL.has(next.status)) {
            const link = agentLinkRef.current[next.id];
            if (link && !linkedResultRef.current.has(next.id)) {
              linkedResultRef.current.add(next.id);
              void postRunResultToAgentChat(link.chatId, link.toolUseId, next);
            }
            void reloadRecent();
            return;
          }
        }
      } catch {}
      setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeRun, reloadRecent]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <Link href="/dashboard/skills" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Skill Center
        </Link>
        <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <div className="flex h-48 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </div>
      </div>
    );
  }

  const meta = metaFor(skill.slug);
  const form = FORMS[skill.slug];

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <Link href="/dashboard/skills" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Skill Center
      </Link>

      <div className="mt-4 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" style={{ color: '#E9E9F0' }}>{skill.name}</h1>
        <div className="flex items-center gap-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <span>{meta.cost}</span>
          <span>·</span>
          <span>{meta.time}</span>
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{skill.description}</p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <RunPanel
          skill={skill}
          form={form}
          activeRun={activeRun}
          onLaunched={(r) => {
            setActiveRun(r);
            void (async () => {
              const toolUseId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
              const chatId = await createRunAgentChat(skill, toolUseId, r);
              if (chatId) agentLinkRef.current[r.id] = { chatId, toolUseId };
            })();
          }}
        />
        <InstallPanel skill={skill} />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Recent runs</h2>
        {recent === null ? (
          <div className="mt-3 flex h-24 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </div>
        ) : recent.length === 0 ? (
          <div className="mt-3 rounded-2xl p-6 text-center text-sm" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D', color: 'rgba(255,255,255,0.5)' }}>
            No runs yet. Run the skill above to see them here.
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recent.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-4 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D' }}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{new Date(it.created_at).toLocaleString()}</span>
                  <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{it.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px]" style={{ color: it.status === 'succeeded' ? '#34D399' : it.status === 'failed' ? '#F87171' : '#A78BFA' }}>{it.status}</span>
                  {it.media_url && (
                    <a href={it.media_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" style={{ color: '#A78BFA' }}>
                      open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function InstallPanel({ skill }: { skill: SkillEntry }) {
  const restSnippet = `curl -X POST https://api.vantly-ugc.com/v1/skills/${skill.slug}/run \\
  -H "Authorization: Bearer $VANTLY_UGC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ /* see input schema */ }'`;

  const cliSnippet = `vantly-ugc skills run ${skill.slug} \\
  --input '{ /* see input schema */ }' --wait`;

  const mcpSnippet = JSON.stringify({
    mcpServers: {
      'vantly-ugc': {
        command: 'npx',
        args: ['-y', '-p', 'vantly-ugc-mcp-server@latest', 'vantly-ugc-mcp'],
        env: { VANTLY_UGC_API_KEY: '${VANTLY_UGC_API_KEY}' },
      },
    },
  }, null, 2);

  const ghLink = `https://github.com/Sangwan70/vantly-ugc/blob/main/public-skill/skills/${skill.slug.replace(/_/g, '-')}/SKILL.md`;

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Use from anywhere</h2>
      <SnippetBlock title="REST" code={restSnippet} />
      <SnippetBlock title="CLI" code={cliSnippet} />
      <SnippetBlock title="MCP (Claude.ai / Cursor / Claude Code)" code={mcpSnippet} />
      <a href={ghLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" style={{ color: '#A78BFA' }}>
        full SKILL.md on gitroom <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function SnippetBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {}
          }}
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: copied ? '#34D399' : 'rgba(255,255,255,0.5)' }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.06)', color: '#E9E9F0' }}>{code}</pre>
    </div>
  );
}
