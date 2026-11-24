// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Smart suggestions (auto-zoom, speed-up, cut, split, clicks) and Review (comments + approval). */

import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Loader2, MessageSquare, RefreshCw, Send, Trash2, Wand2, XCircle } from 'lucide-react';
import { applySuggestion, applySuggestions, sourceToOutput, type EditSuggestionLike, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { studioApi, type Comment, type ReviewStatus, type Role, type StudioProject } from '../_lib/api';
import { fmtTime } from '../_lib/ops';
import { Btn, C } from './ui';

type Update = (fn: (t: VoiceoverTimeline) => VoiceoverTimeline, opts?: { coalesce?: string }) => void;
type Suggestion = NonNullable<StudioProject['analysis']>['suggestions'][number];

const KIND: Record<Suggestion['kind'], { label: string; color: string; verb: string }> = {
  focus: { label: 'Auto-zoom', color: '#7DD3FC', verb: 'Zoom in' },
  speed: { label: 'Speed up', color: '#FCD34D', verb: 'Speed 2×' },
  cut: { label: 'Dead air', color: '#F87171', verb: 'Cut' },
  split: { label: 'Scene change', color: '#A3A3A3', verb: 'Split' },
  click: { label: 'Click', color: '#FB7185', verb: 'Add ripple' },
};

export function SmartPanel({ project, timeline, update, onSeek, onRerun }: {
  project: StudioProject;
  timeline: VoiceoverTimeline;
  update: Update;
  onSeek: (t: number) => void;
  onRerun: () => void;
}) {
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const all = project.analysis?.suggestions ?? [];
  const live = all.filter((s) => !applied.has(s.id) && sourceToOutput(timeline, s.start));
  const status = project.prepare_status;
  const apply = (s: EditSuggestionLike) => { update((t) => applySuggestion(t, s)); setApplied((a) => new Set(a).add(s.id)); };
  const applyKind = (kinds: Suggestion['kind'][]) => {
    const pick = live.filter((s) => kinds.includes(s.kind));
    update((t) => applySuggestions(t, pick, kinds));
    setApplied((a) => { const n = new Set(a); pick.forEach((s) => n.add(s.id)); return n; });
  };
  const count = (k: Suggestion['kind']) => live.filter((s) => s.kind === k).length;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4" style={{ color: C.accent }} />
        <p className="text-xs font-semibold" style={{ color: C.text }}>Smart edit</p>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: C.muted }} onClick={onRerun}><RefreshCw className="h-3 w-3" /> Re-analyse</button>
      </div>
      {status !== 'ready' ? (
        <div className="flex items-center gap-2 rounded-lg p-2 text-[11px]" style={{ background: C.bg, color: C.muted }}>
          {status === 'failed' ? 'Analysis failed — try Re-analyse.' : <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing the recording for clicks, dead air and scene changes…</>}
        </div>
      ) : (
        <>
          <p className="text-[11px]" style={{ color: C.muted }}>Found in your recording. Apply one at a time, or a whole kind at once — everything is undoable.</p>
          <div className="flex flex-wrap gap-1.5">
            <Btn small primary disabled={!live.length} onClick={() => applyKind(['cut', 'speed', 'focus', 'click'])}><Wand2 className="h-3.5 w-3.5" /> Apply all ({live.filter((s) => s.kind !== 'split').length})</Btn>
            {(['focus', 'speed', 'cut', 'click'] as const).map((k) => count(k) ? <Btn key={k} small onClick={() => applyKind([k])}>{KIND[k].label} · {count(k)}</Btn> : null)}
          </div>
          <div className="space-y-1.5">
            {live.slice(0, 80).map((s) => {
              const at = sourceToOutput(timeline, s.start)?.out ?? 0;
              return (
                <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                  <span className="h-2 w-2 shrink-0 rotate-45 rounded-[2px]" style={{ background: KIND[s.kind].color }} />
                  <button type="button" className="font-mono hover:underline" style={{ color: C.text }} onClick={() => onSeek(at)}>{fmtTime(at)}</button>
                  <span className="truncate" style={{ color: C.muted }}>{KIND[s.kind].label} · {s.reason}{s.zoom ? ` · ${s.zoom}×` : ''}</span>
                  <button type="button" className="ml-auto shrink-0 rounded px-1.5 py-0.5" style={{ border: `1px solid ${C.line2}`, color: C.text }} onClick={() => apply(s)}>{KIND[s.kind].verb}</button>
                </div>
              );
            })}
            {!live.length ? <p className="text-[11px]" style={{ color: C.faint }}>No suggestions left.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

const STATUS: Record<ReviewStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: C.muted },
  in_review: { label: 'In review', color: '#FCD34D' },
  changes_requested: { label: 'Changes requested', color: '#FCA5A5' },
  approved: { label: 'Approved', color: '#6EE7B7' },
};

export function ReviewPanel({ projectId, status, role, requireApproval, time, onSeek, onStatus, onComments }: {
  projectId: string;
  status: ReviewStatus;
  role: Role;
  requireApproval: boolean;
  time: number;
  onSeek: (t: number) => void;
  onStatus: (s: ReviewStatus) => void;
  onComments: (c: Comment[]) => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [pinned, setPinned] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const canEdit = ['owner', 'admin', 'editor'].includes(role);
  const canApprove = ['owner', 'admin', 'reviewer'].includes(role);
  const canComment = role !== 'viewer';

  const load = () => studioApi.comments(projectId).then((r) => { setComments(r.comments); onComments(r.comments); }).catch((e: Error) => setErr(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [projectId]);

  const act = async (action: 'submit' | 'approve' | 'request_changes' | 'reopen') => {
    setErr(null);
    try { const r = await studioApi.review(projectId, action, note.trim() || undefined); onStatus(r.review_status); setNote(''); await load(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold" style={{ color: C.text }}>Review</p>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.bg, color: STATUS[status].color }}>{STATUS[status].label}</span>
        {requireApproval ? <span className="ml-auto text-[10px]" style={{ color: C.faint }}>Approval required for final renders</span> : null}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note for the reviewer / author (optional)"
        className="w-full rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} />
      <div className="flex flex-wrap gap-1.5">
        {canEdit && (status === 'draft' || status === 'changes_requested') ? <Btn small primary onClick={() => act('submit')}><Send className="h-3.5 w-3.5" /> Submit for review</Btn> : null}
        {canApprove && status === 'in_review' ? <Btn small primary onClick={() => act('approve')}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Btn> : null}
        {canApprove && status === 'in_review' ? <Btn small onClick={() => act('request_changes')}><XCircle className="h-3.5 w-3.5" /> Request changes</Btn> : null}
        {canEdit && status === 'approved' ? <Btn small onClick={() => act('reopen')}>Reopen</Btn> : null}
      </div>
      {err ? <p className="text-[11px]" style={{ color: '#FCA5A5' }}>{err}</p> : null}

      <div className="pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.text }}><MessageSquare className="h-3.5 w-3.5" /> Comments</p>
        {canComment ? (
          <div className="mb-2 space-y-1.5">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Leave feedback…"
              className="w-full rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> at {fmtTime(time)}</label>
              <Btn small primary disabled={!body.trim()} onClick={async () => {
                try { await studioApi.addComment(projectId, { body: body.trim(), t: pinned ? time : null }); setBody(''); await load(); } catch (e) { setErr((e as Error).message); }
              }}>Comment</Btn>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          {(comments ?? []).slice().reverse().map((c) => (
            <div key={c.id} className="rounded-lg p-2 text-[11px]" style={{ background: C.card, border: `1px solid ${C.line}`, opacity: c.resolved ? 0.5 : 1 }}>
              <div className="flex items-center gap-1.5" style={{ color: C.muted }}>
                <span className="truncate">{c.author_email ?? 'someone'}</span>
                {c.kind !== 'comment' ? <span style={{ color: STATUS[c.kind === 'approve' ? 'approved' : c.kind === 'request_changes' ? 'changes_requested' : 'in_review'].color }}>· {c.kind.replace('_', ' ')}</span> : null}
                {c.t !== null ? <button type="button" className="font-mono hover:underline" style={{ color: '#F472B6' }} onClick={() => onSeek(Number(c.t))}>{fmtTime(Number(c.t))}</button> : null}
                <span className="ml-auto">{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap" style={{ color: C.text }}>{c.body}</p>
              {canComment && c.kind === 'comment' ? (
                <div className="mt-1 flex gap-2">
                  <button type="button" className="inline-flex items-center gap-1" style={{ color: C.muted }} onClick={async () => { await studioApi.patchComment(c.id, { resolved: !c.resolved }); await load(); }}><Check className="h-3 w-3" /> {c.resolved ? 'Reopen' : 'Resolve'}</button>
                  <button type="button" className="inline-flex items-center gap-1" style={{ color: '#FCA5A5' }} onClick={async () => { await studioApi.deleteComment(c.id).catch(() => {}); await load(); }}><Trash2 className="h-3 w-3" /></button>
                </div>
              ) : null}
            </div>
          ))}
          {comments && !comments.length ? <p className="text-[11px]" style={{ color: C.faint }}>No comments yet.</p> : null}
        </div>
      </div>
    </div>
  );
}
