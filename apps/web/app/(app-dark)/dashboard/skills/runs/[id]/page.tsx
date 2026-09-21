// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/skills/runs/[id] — single run timeline.
 *
 * Polls /v1/skills/runs/:id (composed) or /v1/primitives/runs/:id
 * (standalone) every 4s until terminal. Renders step-by-step status,
 * embedded video player for the final artifact, and the original
 * input + cost.
 */

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { estimateSkillEta } from '../../_run-panel';
import { prettyPrimitiveLabel, prettyStepLabel, storybookMilestoneIndex, STORYBOOK_MILESTONES } from '../../_step-labels';
import { RetryButton } from '../../_retry';
import { RunInputView } from '../../_run-input-view';

interface Artifact { url: string; kind?: string; mime?: string | null; bytes?: number }
interface StepEntry { primitive_run_id?: string; primitive: string; status: string; started_at?: string | null; finished_at?: string | null; error?: { code: string; message: string | null } | null; artifacts?: Artifact[] }
interface RunBody {
  // skill-run flavor
  skill_run_id?: string;
  skill?: string;
  current_step?: string | null;
  steps?: StepEntry[];
  final_output?: Record<string, unknown> | null;
  // primitive-run flavor
  run_id?: string;
  primitive?: string;
  artifacts?: Artifact[];
  // shared
  video_duration_seconds?: number | null;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  error?: { code: string; message: string | null } | null;
  // Composed-skill runs only -- see lib/skill-run-status.ts's
  // computeRunHealth on the backend.
  stalled?: boolean;
  stalled_for_seconds?: number | null;
}

const TERMINAL = new Set(['succeeded', 'completed', 'success', 'failed', 'canceled', 'cancelled']);

/**
 * Short, non-technical explanations for the error codes primitive-worker-vnext
 * throws (see ApplicationFailure.nonRetryable call sites in
 * services/primitive-worker-vnext/src/activities/*.ts and the workflow-level
 * NON_RETRYABLE lists). Falls back to the raw technical message when a code
 * isn't recognized — "if known" per the ask, never hides real detail.
 */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "Some of the input for this generation wasn't valid.",
  BUDGET_CAP_PRIMITIVE: "This request costs more than the server's per-generation spending limit allows.",
  BUDGET_CAP_DAY: "Today's spending limit for your account has been reached — try again tomorrow.",
  INSUFFICIENT_CREDITS: 'Not enough credits to run this.',
  REFERENCE_FETCH_FAILED: "Couldn't download one of the reference images or videos you provided.",
  REFERENCE_NOT_IMAGE: "One of the reference files isn't a valid image.",
  REFERENCE_NOT_VIDEO: "One of the reference files isn't a valid video.",
  REFERENCE_URL_NOT_ALLOWED: "One of the reference files wasn't hosted somewhere this server can use.",
  PROVIDER_UNCONFIGURED: "This feature isn't fully configured on the server yet.",
  TRANSCRIBE_EMPTY: 'No speech was detected to generate captions from.',
};

function friendlyErrorMessage(code: string | null | undefined, message: string | null | undefined): string {
  if (code && FRIENDLY_ERROR_MESSAGES[code]) return FRIENDLY_ERROR_MESSAGES[code];
  if (code === 'OPENAI_451' || code === 'EVOLINK_451') return 'Blocked by the AI provider\'s content policy.';
  if (code && /^(OPENAI|EVOLINK)_(400|401|403|404|413|415|422)$/.test(code)) {
    return `The AI ${code.startsWith('OPENAI') ? 'image' : 'video'} provider rejected this request.`;
  }
  if (code && /^(OPENAI|EVOLINK)_(UNKNOWN|TRANSIENT)$/.test(code)) {
    return 'A temporary provider error occurred.';
  }
  return message?.trim() || 'This run failed for an unknown reason — check the server logs.';
}

/**
 * make_ugc_video's real, fixed step sequence (see workflows/make-ugc-video.ts
 * -- portrait and character_sheet are near-instant compared to the actual
 * video render, so this bar is time-weighted rather than an equal 1/5-per-step
 * split, which would sit the bar at "40% done" for the several minutes the
 * selfie step (the seedance-2.0 render, the real long pole) is running. Two
 * steps here are conditionally skipped by the workflow (portrait when the
 * caller supplied portrait_url directly; subtitles/watermark when the
 * caller opted out) -- skipped steps simply never appear as `current_step`
 * or in `steps[]`, so they drop out of the "completed weight so far" sum
 * without needing to be special-cased.
 */
const MAKE_UGC_STEP_ORDER = ['portrait', 'character_sheet', 'selfie', 'subtitles', 'watermark'] as const;
const MAKE_UGC_STEP_WEIGHT: Record<(typeof MAKE_UGC_STEP_ORDER)[number], number> = {
  portrait: 0.05,
  character_sheet: 0.05,
  selfie: 0.8,
  subtitles: 0.05,
  watermark: 0.05,
};
const MAKE_UGC_STEP_LABEL: Record<string, string> = {
  portrait: 'Generating portrait',
  character_sheet: 'Building character sheet',
  selfie: 'Rendering video',
  subtitles: 'Adding captions',
  watermark: 'Adding watermark',
  done: 'Finalizing',
};
// steps[].primitive uses the worker's activity names, not the shorter
// current_step keys the workflow signals with -- see
// services/primitive-worker-vnext/src/activities/*.ts.
const PRIMITIVE_TO_MAKE_UGC_STEP: Record<string, string> = {
  portrait_gpt2: 'portrait',
  character_sheet_gpt2: 'character_sheet',
  simple_selfie: 'selfie',
  subtitles: 'subtitles',
  watermark: 'watermark',
};
// seedance-2.0 renders roughly 36s of wall-clock time per second of output
// video (packages/schema/src/v2/models.ts's "~3 min for a 5s clip" data
// point) -- matches estimateMakeUgcVideoEta's own constant in _run-panel.tsx.
function expectedMakeUgcStepSeconds(step: string, durationSeconds: number | null | undefined): number {
  switch (step) {
    case 'portrait': return 30;
    case 'character_sheet': return 15;
    case 'selfie': return Math.max(30, (durationSeconds ?? 10) * 36);
    case 'subtitles': return 20;
    case 'watermark': return 15;
    default: return 30;
  }
}

interface MakeUgcProgress { fraction: number; label: string }

/**
 * Grounded in the same primitive_runs rows the Timeline section below
 * already renders (never a guess independent of real backend state): every
 * step strictly before the current one is fully counted, and the current
 * step gets partial credit from how long its own primitive_runs row has
 * been running versus how long that step normally takes -- capped short of
 * 100% of its own weight so the bar can never visually finish before the
 * step's row actually flips to succeeded/failed.
 */
function computeMakeUgcProgress(body: RunBody, nowMs: number): MakeUgcProgress {
  if (body.status === 'succeeded') return { fraction: 1, label: MAKE_UGC_STEP_LABEL.done };
  const cur = body.current_step ?? null;
  if (!cur || cur === 'done') {
    return { fraction: cur === 'done' ? 1 : 0, label: cur === 'done' ? MAKE_UGC_STEP_LABEL.done : 'Queued' };
  }
  const idx = MAKE_UGC_STEP_ORDER.indexOf(cur as (typeof MAKE_UGC_STEP_ORDER)[number]);
  if (idx === -1) return { fraction: 0, label: cur };
  let completed = 0;
  for (let i = 0; i < idx; i++) completed += MAKE_UGC_STEP_WEIGHT[MAKE_UGC_STEP_ORDER[i]];
  const curStepRow = (body.steps ?? []).find((s) => PRIMITIVE_TO_MAKE_UGC_STEP[s.primitive] === cur);
  const stepStartedAtMs = curStepRow?.started_at
    ? new Date(curStepRow.started_at).getTime()
    : body.started_at
      ? new Date(body.started_at).getTime()
      : null;
  const expectedMs = expectedMakeUgcStepSeconds(cur, body.video_duration_seconds) * 1000;
  const withinStep = stepStartedAtMs != null ? Math.max(0, nowMs - stepStartedAtMs) / expectedMs : 0.4;
  const partial = Math.min(0.92, withinStep);
  const fraction = Math.min(0.99, completed + MAKE_UGC_STEP_WEIGHT[cur as (typeof MAKE_UGC_STEP_ORDER)[number]] * partial);
  return { fraction, label: MAKE_UGC_STEP_LABEL[cur] ?? cur };
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.round(sec % 60));
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ProgressBar({ fraction, indeterminate }: { fraction: number; indeterminate?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <div
        className={indeterminate ? 'h-full animate-pulse' : 'h-full transition-[width] duration-700 ease-out'}
        style={{
          width: indeterminate ? '40%' : `${Math.round(fraction * 100)}%`,
          backgroundColor: '#A78BFA',
          borderRadius: 9999,
        }}
      />
    </div>
  );
}

/**
 * Live progress + approx-time section for the run-detail page. Real,
 * time-weighted progress for make_ugc_video (the skill this session's
 * whole investigation centered on); an honest indeterminate bar for
 * every other composed skill, whose step count varies per run (scene/clip
 * counts) and so has no reliable fixed total to compute a true fraction
 * against -- showing a fabricated percentage there would be worse than
 * showing none.
 */
function RunProgress({ body }: { body: RunBody }) {
  const terminal = TERMINAL.has(body.status);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [terminal]);
  if (body.status === 'succeeded') return null;

  const startedAtMs = body.started_at ? new Date(body.started_at).getTime() : body.created_at ? new Date(body.created_at).getTime() : null;
  const endMs = terminal && body.finished_at ? new Date(body.finished_at).getTime() : nowMs;
  const elapsedSec = startedAtMs != null ? Math.max(0, (endMs - startedAtMs) / 1000) : null;

  const isMakeUgc = body.skill === 'make_ugc_video' || body.skill === 'make_ugc';
  const isStorybook = body.skill === 'make_storybook';
  const progress = isMakeUgc ? computeMakeUgcProgress(body, nowMs) : null;
  const etaText = isMakeUgc && body.skill ? estimateSkillEta(body.skill, { duration: body.video_duration_seconds ?? undefined }) : 'a few minutes \u2014 sometimes longer for video';
  // make_storybook has no fixed total (scene/character counts vary per
  // run and aren't in this response), so -- same reasoning as the "no
  // fabricated percentage" comment above -- this shows real milestones
  // (which of characters/scenes/compose/subtitles is actually running
  // right now, from the same current_step the backend already reports)
  // instead of inventing a completion percentage.
  const milestoneIdx = isStorybook ? storybookMilestoneIndex(body.current_step) : -1;
  const stepLabel = progress ? progress.label : prettyStepLabel(body.current_step);

  return (
    <div className="mt-4 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D' }}>
      <div className="flex items-center justify-between gap-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <span>{stepLabel}</span>
        <span>{progress ? `${Math.round(progress.fraction * 100)}%` : null}</span>
      </div>
      {isStorybook && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {STORYBOOK_MILESTONES.map((m, i) => (
            <div key={m} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={i === milestoneIdx ? 'h-1.5 w-full animate-pulse rounded-full' : 'h-1.5 w-full rounded-full'}
                style={{ backgroundColor: i < milestoneIdx ? '#34D399' : i === milestoneIdx ? '#A78BFA' : 'rgba(255,255,255,0.1)' }}
              />
              <span className="text-center text-[10px] capitalize" style={{ color: i === milestoneIdx ? '#E9E9F0' : 'rgba(255,255,255,0.35)' }}>
                {m}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2">
        <ProgressBar fraction={progress?.fraction ?? 0} indeterminate={!progress} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        <span>{elapsedSec != null ? `Elapsed: ${formatElapsed(elapsedSec)}` : null}</span>
        {!terminal && <span>Typically {etaText}</span>}
      </div>
    </div>
  );
}

export default function RunTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const forcedComposed = search?.get('composed') === '1';
  const [body, setBody] = useState<RunBody | null>(null);
  const [composed, setComposed] = useState<boolean>(forcedComposed);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const fetchOnce = async () => {
      try {
        // The URL already told us which table this run lives in
        // (CreateComposer/RunPanel link here with ?composed=1 for every
        // composed skill_runs id) -- go straight to skills/runs instead of
        // probing primitives/runs first and discarding a guaranteed 404.
        // That probe used to run on EVERY 4s poll tick for the run's whole
        // lifetime regardless of forcedComposed (the old `|| forcedComposed`
        // check only decided whether to ALSO fetch skills/runs afterward,
        // not whether to skip the primitives probe) -- confirmed live via a
        // HAR showing a steady stream of primitives/runs 404s alongside the
        // real skills/runs 200s for one make_ugc_video run's entire
        // detail-page session. Harmless to the data shown, but doubled the
        // request count and spammed error monitoring with a 404 that was
        // never actually an error.
        let resp: Response;
        let didCompose: boolean;
        if (forcedComposed) {
          resp = await fetch(`/api/v1/skills/runs/${encodeURIComponent(id)}`, { credentials: 'include' });
          didCompose = true;
        } else {
          resp = await fetch(`/api/v1/primitives/runs/${encodeURIComponent(id)}`, { credentials: 'include' });
          didCompose = false;
          if (!resp.ok) {
            resp = await fetch(`/api/v1/skills/runs/${encodeURIComponent(id)}`, { credentials: 'include' });
            didCompose = true;
          }
        }
        if (!resp.ok) {
          setError(`run ${resp.status}`);
          return false;
        }
        const data = (await resp.json()) as RunBody;
        setComposed(didCompose);
        setBody(data);
        return TERMINAL.has(data.status);
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    };
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (inFlight) return;
      inFlight = true;
      const done = await fetchOnce();
      inFlight = false;
      if (cancelled || done || stopped.current) return;
      timer = setTimeout(loop, 4000);
    };
    // A backgrounded tab has its poll timers throttled -- or fully frozen,
    // which Chrome does to hidden tabs after ~5 minutes -- by the browser.
    // A run that finishes while the tab is hidden then keeps showing its
    // last-known status (e.g. "running") until whatever throttled timer
    // eventually fires, which can be many minutes after someone actually
    // looks at the tab again. Force an immediate refetch the moment the tab
    // becomes visible so the page never shows stale status to someone who
    // just tabbed back in. Confirmed against a real run (b15f6b9c) that
    // finished server-side in 36 seconds but whose open tab still showed
    // "running" 43+ minutes later -- skill_runs/skill_run_status_events
    // showed the run started and failed within the same minute; nothing
    // was actually stuck, the open tab just never got to poll again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer != null) { clearTimeout(timer); timer = null; }
      void loop();
    };
    document.addEventListener('visibilitychange', onVisible);
    void loop();
    return () => {
      cancelled = true;
      stopped.current = true;
      if (timer != null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, forcedComposed]);

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <Link href="/dashboard/skills" className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Skill Center
      </Link>

      {error && (
        <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          {error}
        </div>
      )}

      {!body && !error && (
        <div className="mt-4 flex h-48 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </div>
      )}

      {body && <RunBodyView body={body} composed={composed} id={id} />}
    </div>
  );
}

function RunBodyView({ body, composed, id }: { body: RunBody; composed: boolean; id: string }) {
  const terminal = TERMINAL.has(body.status);
  const finalUrl = pickFinalUrl(body);
  const isVideo = finalUrl ? /\.(mp4|webm|mov)(\?|$)/i.test(finalUrl) : false;
  const startedAt = body.started_at ?? body.created_at ?? null;
  const finishedAt = body.finished_at ?? null;
  const elapsedSec = startedAt && finishedAt ? Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000) : null;
  const [cancelState, setCancelState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  async function cancelRun() {
    if (cancelState === 'working') return;
    setCancelState('working');
    try {
      const r = await fetch(`/api/v1/skills/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST', credentials: 'include' });
      setCancelState(r.ok ? 'done' : 'error');
    } catch {
      setCancelState('error');
    }
  }

  return (
    <>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#E9E9F0' }}>{body.skill ?? body.primitive ?? 'Run'}</h1>
          <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Run id: <code>{id}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px]" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          {!terminal && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />}
          <span style={{ color: body.status === 'succeeded' ? '#34D399' : body.status === 'failed' ? '#F87171' : '#A78BFA' }}>{body.status}</span>
        </div>
      </div>

      {composed && body.stalled && !terminal && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ border: '1px solid rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.08)' }}>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: '#FCD34D' }}>This looks stuck</div>
            <p className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              No progress reported {body.stalled_for_seconds ? `for about ${Math.round(body.stalled_for_seconds / 60)} min` : 'for a while'} — this is taking noticeably longer than normal for this step. It may still recover on its own, or you can cancel it now (credits are refunded) and retry.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void cancelRun()}
              disabled={cancelState === 'working' || cancelState === 'done'}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
            >
              {cancelState === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {cancelState === 'done' ? 'Canceled' : cancelState === 'working' ? 'Canceling…' : 'Cancel run'}
            </button>
            <RetryButton runId={id} skillLabel={body.skill ?? undefined} />
          </div>
        </div>
      )}
      {cancelState === 'error' && (
        <p className="mt-1 text-[12px]" style={{ color: '#F87171' }}>Couldn&apos;t cancel — try again in a moment.</p>
      )}

      <RunProgress body={body} />

      <RunInputView skillOrPrimitive={composed ? body.skill : body.primitive} composed={composed} runId={id} />

      {body.error && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          <div>
            <div className="font-medium">{friendlyErrorMessage(body.error.code, body.error.message)}</div>
            {(body.error.code || body.error.message) && (
              <div className="mt-1 text-[11px]" style={{ color: 'rgba(252,165,165,0.65)' }}>
                {body.error.code}{body.error.message ? `: ${body.error.message}` : ''}
              </div>
            )}
          </div>
          {composed && body.status === 'failed' && (
            <div className="shrink-0">
              <RetryButton runId={id} skillLabel={body.skill ?? undefined} />
            </div>
          )}
        </div>
      )}

      {composed && body.steps && body.steps.some((s) => (s.artifacts ?? []).length > 0) && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Generated so far</h2>
          <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Each piece appears here as soon as it&apos;s ready — you don&apos;t have to wait for the whole run to see them.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {body.steps.flatMap((s, si) =>
              (s.artifacts ?? []).map((a, ai) => {
                const artIsVideo = /\.(mp4|webm|mov)(\?|$)/i.test(a.url) || (a.mime ?? '').startsWith('video/');
                return (
                  <a
                    key={`${si}-${ai}`}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative flex flex-col overflow-hidden rounded-xl"
                    style={{ border: '1px solid rgba(255,255,255,0.08)', backgroundColor: '#0F1015' }}
                  >
                    <div className="relative aspect-square w-full overflow-hidden" style={{ backgroundColor: '#15161D' }}>
                      {artIsVideo ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={a.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={prettyPrimitiveLabel(s.primitive)} className="h-full w-full object-cover" />
                      )}
                      <span className="absolute right-1.5 top-1.5 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                        <ExternalLink className="h-3 w-3" style={{ color: '#fff' }} />
                      </span>
                    </div>
                    <span className="truncate px-2 py-1.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{prettyPrimitiveLabel(s.primitive)}</span>
                  </a>
                );
              }),
            )}
          </div>
        </section>
      )}

      {composed && body.steps && body.steps.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Timeline</h2>
          <ol className="mt-3 flex flex-col gap-2">
            {body.steps.map((s, i) => {
              const dur = s.started_at && s.finished_at ? Math.max(1, Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000)) : null;
              return (
                <li key={`${s.primitive}-${i}`} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#15161D' }}>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: s.status === 'succeeded' ? '#34D399' : s.status === 'failed' ? '#F87171' : '#A78BFA' }} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{prettyPrimitiveLabel(s.primitive)}</span>
                      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.status}{dur != null ? ` · ${dur}s` : ''}</span>
                      {s.status === 'failed' && s.error && (
                        <span className="mt-0.5 text-[11px]" style={{ color: '#F87171' }}>{friendlyErrorMessage(s.error.code, s.error.message)}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {finalUrl && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Final {isVideo ? 'video' : 'artifact'}</h2>
          <div className="mt-3 overflow-hidden rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#0F1015' }}>
            {isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={finalUrl} controls className="w-full" style={{ maxHeight: 720 }} />
            ) : (
              <img src={finalUrl} alt="output" className="w-full" />
            )}
          </div>
          <a href={finalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline" style={{ color: '#A78BFA' }}>
            open in new tab <ExternalLink className="h-3 w-3" />
          </a>
        </section>
      )}

      {elapsedSec != null && (
        <p className="mt-6 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Total wall time: {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s
        </p>
      )}
    </>
  );
}

function pickFinalUrl(body: RunBody): string | null {
  const out = body.final_output as Record<string, unknown> | undefined;
  if (out && typeof out.video_url === 'string') return out.video_url;
  if (body.artifacts && body.artifacts[0]) return body.artifacts[0].url ?? null;
  if (body.steps && body.steps.length > 0) {
    const last = body.steps[body.steps.length - 1];
    return last.artifacts?.[0]?.url ?? null;
  }
  return null;
}
