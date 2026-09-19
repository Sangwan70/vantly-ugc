// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * "Retry" for a composed skill run, from anywhere that shows one:
 * dashboard/jobs, dashboard/skills/runs/[id], and the agent chat's own
 * inline status chip. All three send the user to the SAME place --
 * /dashboard/agent's "+ -> Run a skill" RunPanel modal, pre-filled with
 * the run's original input -- rather than each reimplementing "fetch the
 * input, stash it, redirect".
 *
 * The original input (skill_runs.input, GET /v1/skills/runs/:id/input)
 * can carry reference-image URLs and other non-trivial content, so it's
 * round-tripped through sessionStorage rather than the URL query string:
 * stashRetryDraft() writes it right before navigating to
 * /dashboard/agent?resume_skill=<slug>; popRetryDraft() reads-and-clears
 * it there. sessionStorage (not localStorage) deliberately -- a stale
 * leftover draft should not silently resurrect itself in a later,
 * unrelated tab/session.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const RETRY_DRAFT_KEY = 'vantly:retry-draft';

export interface RetryDraft {
  skill: string;
  input: Record<string, unknown>;
}

export function stashRetryDraft(draft: RetryDraft): void {
  try {
    sessionStorage.setItem(RETRY_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* sessionStorage unavailable (private mode, etc.) -- the resume_skill
     * page will just find nothing to prefill and open the form empty. */
  }
}

export function popRetryDraft(): RetryDraft | null {
  try {
    const raw = sessionStorage.getItem(RETRY_DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RETRY_DRAFT_KEY);
    const parsed = JSON.parse(raw) as RetryDraft;
    if (!parsed || typeof parsed.skill !== 'string' || typeof parsed.input !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Button + confirm modal + fetch + redirect, in one place. `runId` is a
 * skill_runs id (composed skill only -- standalone primitive_runs have no
 * retry-with-prefill support today, they don't carry the rich structured
 * input a composed skill's RunPanel form needs).
 */
export function RetryButton({
  runId,
  skillLabel,
  variant = 'solid',
}: {
  runId: string;
  skillLabel?: string;
  variant?: 'solid' | 'outline';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/v1/skills/runs/${encodeURIComponent(runId)}/input`, { credentials: 'include' });
      if (!r.ok) throw new Error(`Could not load this run's original details (${r.status}).`);
      const data = (await r.json()) as { skill?: string; input?: Record<string, unknown> };
      if (!data.skill || !data.input) throw new Error("This run's original details aren't available to retry.");
      stashRetryDraft({ skill: data.skill, input: data.input });
      router.push(`/dashboard/agent?resume_skill=${encodeURIComponent(data.skill)}`);
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
    }
  }

  const solidClass = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-opacity hover:opacity-90';
  const outlineClass = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] transition-opacity hover:opacity-90';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className={variant === 'solid' ? solidClass : outlineClass}
        style={variant === 'solid' ? { background: '#A78BFA', color: '#0F1015' } : { border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
      >
        Retry
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: '#15161D', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold" style={{ color: '#E9E9F0' }}>Retry this {skillLabel ?? 'generation'}?</h3>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              We&apos;ll open a new chat with the same details already filled in, so you can double-check them and hit Generate again.
            </p>
            {err && <p className="mt-2 text-[12px]" style={{ color: '#F87171' }}>{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={loading}
                className="rounded-md px-3 py-1.5 text-[13px] font-semibold disabled:opacity-60"
                style={{ background: '#A78BFA', color: '#0F1015' }}
              >
                {loading ? 'Loading…' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
