// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Four-track timeline: Video (clips + title cards; drag edges to trim;
 * filmstrip thumbnails; transition badges), Voice (ElevenLabs blocks; drag to
 * move), Text (overlays; drag / resize), Effects (click, spotlight, highlight,
 * arrow, redaction). The ruler shows smart-edit suggestions and review
 * comments; click a marker to jump there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Mic, Type, Sparkles, ZoomIn, ZoomOut, Search, MessageSquare, Wand2 } from 'lucide-react';
import { clipOutputDuration, sourceToOutput, transitionOverlap, type VoiceoverClip, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { blockDuration, blockIsStale, clipStarts, fmtTime } from '../_lib/ops';
import type { Comment, Filmstrip, StudioProject, StudioSource } from '../_lib/api';

export type Selection = { kind: 'clip' | 'block' | 'overlay' | 'effect'; id: string } | null;
type Suggestion = NonNullable<StudioProject['analysis']>['suggestions'][number];

interface Props {
  timeline: VoiceoverTimeline;
  source: StudioSource;
  time: number;
  duration: number;
  selection: Selection;
  suggestions: Suggestion[];
  comments: Comment[];
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onClipChange: (id: string, patch: Partial<VoiceoverClip>) => void;
  onBlockMove: (id: string, start: number) => void;
  onOverlayChange: (id: string, start: number, end: number) => void;
  onEffectChange: (id: string, start: number, end: number) => void;
  onSuggestion: (s: Suggestion) => void;
}

const LABEL_W = 92;
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const FX_COLOR: Record<string, string> = { click: '#7F1D1D', spotlight: '#1E293B', highlight: '#713F12', arrow: '#713F12', blur: '#334155' };
const SUG_COLOR: Record<string, string> = { focus: '#7DD3FC', cut: '#F87171', speed: '#FCD34D', split: '#A3A3A3', click: '#FB7185' };

type Drag =
  | { kind: 'trim-in' | 'trim-out'; id: string; x0: number; orig: VoiceoverClip }
  | { kind: 'block'; id: string; x0: number; orig: number }
  | { kind: 'range' | 'range-end'; target: 'overlay' | 'effect'; id: string; x0: number; s0: number; e0: number }
  | { kind: 'scrub' };

export function Timeline(p: Props) {
  const { timeline } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40);
  const drag = useRef<Drag | null>(null);
  const starts = useMemo(() => clipStarts(timeline), [timeline]);
  const width = Math.max(600, (p.duration + 5) * pps);
  const step = STEPS.find((s) => s * pps >= 70) ?? 120;

  const fitted = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || fitted.current || p.duration <= 0) return;
    fitted.current = true;
    setPps(Math.max(4, Math.min(120, (el.clientWidth - LABEL_W - 40) / p.duration)));
  }, [p.duration]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = p.time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [p.time, pps]);

  // Suggestions are in source time → place them on the output timeline (drop the ones that were cut).
  const placed = useMemo(
    () => p.suggestions.filter((s) => s.kind !== 'click').map((s) => ({ s, at: sourceToOutput(timeline, s.start)?.out })).filter((x): x is { s: Suggestion; at: number } => x.at !== undefined),
    [p.suggestions, timeline],
  );

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(p.duration, (clientX - r.left - LABEL_W + el.scrollLeft) / pps));
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'scrub') { p.onSeek(xToTime(e.clientX)); return; }
    const dt = (e.clientX - d.x0) / pps;
    if (d.kind === 'trim-in') {
      p.onClipChange(d.id, { src_in: Math.max(0, Math.min(d.orig.src_out - 0.1, d.orig.src_in + dt * d.orig.speed)) });
    } else if (d.kind === 'trim-out') {
      p.onClipChange(d.id, { src_out: Math.min(p.source.duration, Math.max(d.orig.src_in + 0.1, d.orig.src_out + dt * d.orig.speed)) });
    } else if (d.kind === 'block') {
      p.onBlockMove(d.id, Math.max(0, d.orig + dt));
    } else if (d.kind === 'range' || d.kind === 'range-end') {
      const change = d.target === 'overlay' ? p.onOverlayChange : p.onEffectChange;
      if (d.kind === 'range') {
        const len = d.e0 - d.s0;
        const s = Math.max(0, Math.min(p.duration - len, d.s0 + dt));
        change(d.id, s, s + len);
      } else {
        change(d.id, d.s0, Math.max(d.s0 + 0.2, Math.min(p.duration, d.e0 + dt)));
      }
    }
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
  };
  const end = () => { drag.current = null; };

  const ticks: number[] = [];
  for (let t = 0; t <= p.duration + step; t += step) ticks.push(t);
  const sel = (kind: string, id: string) => p.selection?.kind === kind && p.selection.id === id;

  return (
    <div className="flex h-full flex-col" style={{ background: '#0B0C11', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <span className="font-mono" style={{ color: '#E9E9F0' }}>{fmtTime(p.time)}</span>
        <span>/ {fmtTime(p.duration)}</span>
        {placed.length ? <span className="ml-3 inline-flex items-center gap-1"><Wand2 className="h-3 w-3" style={{ color: '#7DD3FC' }} /> {placed.length} smart suggestions on the ruler</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Zoom out" onClick={() => setPps((v) => Math.max(2, v / 1.5))} className="rounded p-1 hover:bg-white/5"><ZoomOut className="h-3.5 w-3.5" /></button>
          <button type="button" title="Fit" onClick={() => { const el = scrollRef.current; if (el) setPps(Math.max(2, (el.clientWidth - LABEL_W - 40) / Math.max(1, p.duration))); }} className="rounded p-1 hover:bg-white/5"><Search className="h-3.5 w-3.5" /></button>
          <button type="button" title="Zoom in" onClick={() => setPps((v) => Math.min(400, v * 1.5))} className="rounded p-1 hover:bg-white/5"><ZoomIn className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-x-auto overflow-y-hidden"
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setPps((v) => Math.max(2, Math.min(400, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } }}
      >
        <div className="relative" style={{ width: width + LABEL_W, minHeight: '100%' }}>
          {/* Ruler + markers */}
          <div className="sticky top-0 z-10 flex h-7 cursor-pointer" style={{ background: '#0B0C11', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            onPointerDown={(e) => { begin(e, { kind: 'scrub' }); p.onSeek(xToTime(e.clientX)); }}>
            <div className="sticky left-0 z-20 shrink-0" style={{ width: LABEL_W, background: '#0B0C11' }} />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: t * pps, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                  <span className="ml-1 font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{fmtTime(t, false)}</span>
                </div>
              ))}
              {placed.map(({ s, at }) => (
                <button key={s.id} type="button" title={`${s.kind}: ${s.reason} — click to apply`}
                  onPointerDown={(e) => { e.stopPropagation(); p.onSeek(at); p.onSuggestion(s); }}
                  className="absolute bottom-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px]" style={{ left: at * pps, background: SUG_COLOR[s.kind] ?? '#fff' }} />
              ))}
              {p.comments.filter((c) => c.t !== null && !c.resolved).map((c) => (
                <button key={c.id} type="button" title={c.body} onPointerDown={(e) => { e.stopPropagation(); p.onSeek(Number(c.t)); }}
                  className="absolute top-0.5 -translate-x-1/2" style={{ left: Number(c.t) * pps, color: '#F472B6' }}>
                  <MessageSquare className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>

          <Track icon={<Film className="h-3.5 w-3.5" />} label="Video">
            {timeline.clips.map((c, i) => {
              const d = clipOutputDuration(c);
              const s = sel('clip', c.id);
              const ov = transitionOverlap(timeline, i);
              const isCard = c.kind === 'card';
              return (
                <div key={c.id} className="absolute top-1 bottom-1 overflow-hidden rounded-md text-[10px]"
                  style={{ left: starts[i] * pps, width: Math.max(4, d * pps - 1), background: isCard ? (c.card?.bg ?? '#0B2E5C') : s ? '#3B3270' : '#252640', border: `1px solid ${s ? '#A78BFA' : 'rgba(255,255,255,0.12)'}`, color: '#E9E9F0', zIndex: s ? 2 : 1 }}
                  onPointerDown={(e) => { e.stopPropagation(); p.onSelect({ kind: 'clip', id: c.id }); }}>
                  {!isCard && p.source.filmstrip ? <FilmstripStrip fs={p.source.filmstrip} clip={c} pps={pps} /> : null}
                  <div className="relative truncate px-2 pt-1" style={{ textShadow: '0 1px 2px #000' }}>
                    {isCard ? <b>▣ {c.card?.title || 'Title card'}</b> : <>{fmtTime(c.src_in)}–{fmtTime(c.src_out)}</>}
                    {c.speed !== 1 && !isCard ? <b className="ml-1" style={{ color: '#FCD34D' }}>{c.speed}×</b> : null}
                    {c.keyframes.length ? <span className="ml-1" style={{ color: '#7DD3FC' }}>◆{c.keyframes.length}</span> : c.zoom.mode !== 'none' ? <span className="ml-1" style={{ color: '#7DD3FC' }}>⌕{c.zoom.scale.toFixed(1)}</span> : null}
                  </div>
                  {ov > 0 ? <div title={c.transition.kind} className="absolute top-0 bottom-0 left-0" style={{ width: ov * pps, background: 'linear-gradient(90deg, rgba(167,139,250,0.55), transparent)' }} /> : null}
                  {!isCard ? <Handle side="left" onPointerDown={(e) => begin(e, { kind: 'trim-in', id: c.id, x0: e.clientX, orig: c })} /> : null}
                  {!isCard ? <Handle side="right" onPointerDown={(e) => begin(e, { kind: 'trim-out', id: c.id, x0: e.clientX, orig: c })} /> : null}
                </div>
              );
            })}
          </Track>

          <Track icon={<Mic className="h-3.5 w-3.5" />} label="Voice">
            {timeline.blocks.map((b, i) => {
              const d = blockDuration(b);
              const next = timeline.blocks[i + 1];
              const overlaps = next ? b.start + d > next.start + 0.01 : b.start + d > p.duration + 0.01;
              const s = sel('block', b.id);
              const state = !b.audio_url ? 'draft' : blockIsStale(b) ? 'stale' : 'ready';
              return (
                <div key={b.id} className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-[10px] active:cursor-grabbing"
                  style={{ left: b.start * pps, width: Math.max(6, d * pps - 1), background: state === 'ready' ? '#0F3B33' : state === 'stale' ? '#3D3214' : '#1E2130', border: `1px ${state === 'draft' ? 'dashed' : 'solid'} ${s ? '#A78BFA' : overlaps ? '#F87171' : 'rgba(255,255,255,0.14)'}`, color: '#E9E9F0' }}
                  title={overlaps ? 'Overlaps the next block' : b.text}
                  onPointerDown={(e) => { p.onSelect({ kind: 'block', id: b.id }); begin(e, { kind: 'block', id: b.id, x0: e.clientX, orig: b.start }); }}>
                  {b.audio_url ? <Wave words={b.words} a0={b.audio_in} d={d} /> : null}
                  <div className="relative truncate px-2 pt-1">{b.text || <i style={{ opacity: 0.5 }}>empty</i>}</div>
                </div>
              );
            })}
          </Track>

          <Track icon={<Type className="h-3.5 w-3.5" />} label="Text">
            {timeline.overlays.map((o) => (
              <RangeItem key={o.id} label={o.kind === 'lower_third' ? `▭ ${o.text}` : o.kind === 'callout' ? `➚ ${o.text}` : o.text} start={o.start} end={o.end} pps={pps} bg="#2A1E3D" selected={sel('overlay', o.id)}
                onDown={(e) => { p.onSelect({ kind: 'overlay', id: o.id }); begin(e, { kind: 'range', target: 'overlay', id: o.id, x0: e.clientX, s0: o.start, e0: o.end }); }}
                onEnd={(e) => { p.onSelect({ kind: 'overlay', id: o.id }); begin(e, { kind: 'range-end', target: 'overlay', id: o.id, x0: e.clientX, s0: o.start, e0: o.end }); }} />
            ))}
          </Track>

          <Track icon={<Sparkles className="h-3.5 w-3.5" />} label="Effects">
            {timeline.effects.map((fx) => (
              <RangeItem key={fx.id} label={fx.kind} start={fx.start} end={fx.end} pps={pps} bg={FX_COLOR[fx.kind] ?? '#333'} selected={sel('effect', fx.id)}
                onDown={(e) => { p.onSelect({ kind: 'effect', id: fx.id }); begin(e, { kind: 'range', target: 'effect', id: fx.id, x0: e.clientX, s0: fx.start, e0: fx.end }); }}
                onEnd={(e) => { p.onSelect({ kind: 'effect', id: fx.id }); begin(e, { kind: 'range-end', target: 'effect', id: fx.id, x0: e.clientX, s0: fx.start, e0: fx.end }); }} />
            ))}
          </Track>

          <div className="pointer-events-none absolute top-0 bottom-0 z-30" style={{ left: LABEL_W + p.time * pps, width: 0 }}>
            <div className="absolute -left-[5px] top-0 h-0 w-0" style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #F472B6' }} />
            <div className="absolute top-0 bottom-0" style={{ borderLeft: '1.5px solid #F472B6' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Track({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-12" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 px-3 text-[11px]" style={{ width: LABEL_W, background: '#0B0C11', color: 'rgba(255,255,255,0.55)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        {icon}{label}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function RangeItem({ label, start, end, pps, bg, selected, onDown, onEnd }: { label: string; start: number; end: number; pps: number; bg: string; selected: boolean; onDown: (e: React.PointerEvent) => void; onEnd: (e: React.PointerEvent) => void }) {
  return (
    <div className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-[10px]"
      style={{ left: start * pps, width: Math.max(6, (end - start) * pps - 1), background: bg, border: `1px solid ${selected ? '#A78BFA' : 'rgba(255,255,255,0.14)'}`, color: '#E9E9F0' }}
      onPointerDown={onDown}>
      <div className="truncate px-2 pt-1">{label}</div>
      <Handle side="right" onPointerDown={onEnd} />
    </div>
  );
}

function Handle({ side, onPointerDown }: { side: 'left' | 'right'; onPointerDown: (e: React.PointerEvent) => void }) {
  return <div onPointerDown={onPointerDown} className="absolute top-0 bottom-0 z-10 w-2 cursor-ew-resize hover:bg-white/20" style={{ [side]: 0, background: 'rgba(255,255,255,0.06)' }} />;
}

/** Thumbnails from the prepare step's sprite, one per visible tile width. */
function FilmstripStrip({ fs, clip, pps }: { fs: Filmstrip; clip: VoiceoverClip; pps: number }) {
  const d = clipOutputDuration(clip);
  const tileH = 44;
  const tileW = (fs.tile_w / fs.tile_h) * tileH;
  const n = Math.max(1, Math.ceil((d * pps) / tileW));
  return (
    <div className="pointer-events-none absolute inset-0 flex opacity-60">
      {Array.from({ length: n }, (_, i) => {
        const srcT = clip.src_in + ((i + 0.5) * tileW / pps) * clip.speed;
        const idx = Math.min(fs.count - 1, Math.max(0, Math.floor(srcT / fs.interval)));
        const col = idx % fs.cols;
        const row = Math.floor(idx / fs.cols);
        const sx = tileW / fs.tile_w;
        return <div key={i} style={{ width: tileW, height: tileH, flexShrink: 0, backgroundImage: `url(${fs.url})`, backgroundSize: `${fs.cols * fs.tile_w * sx}px auto`, backgroundPosition: `${-col * fs.tile_w * sx}px ${-row * fs.tile_h * sx}px` }} />;
      })}
    </div>
  );
}

function Wave({ words, a0, d }: { words: { start: number; end: number }[]; a0: number; d: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 h-3">
      {words.filter((w) => w.start >= a0 - 0.01 && w.start - a0 < d).map((w, i) => (
        <div key={i} className="absolute bottom-0 rounded-sm" style={{ left: `${((w.start - a0) / d) * 100}%`, width: `${Math.max(0.4, ((w.end - w.start) / d) * 100)}%`, height: `${40 + ((i * 37) % 60)}%`, background: 'rgba(52,211,153,0.55)' }} />
      ))}
    </div>
  );
}
