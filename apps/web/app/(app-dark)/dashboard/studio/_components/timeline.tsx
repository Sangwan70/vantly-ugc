// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Three-track timeline: Video (clips — trim by dragging the edges), Voice
 * (ElevenLabs blocks — drag to reposition), Text (animated overlays — drag to
 * move, drag the right edge to change length). Click the ruler to seek.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, Mic, Type, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { clipOutputDuration, type VoiceoverSource, type VoiceoverTimeline, type VoiceoverClip } from '@vantly-ugc/schema';
import { blockDuration, blockIsStale, clipStarts, fmtTime } from '../_lib/ops';

export type Selection = { kind: 'clip' | 'block' | 'overlay'; id: string } | null;

interface Props {
  timeline: VoiceoverTimeline;
  source: VoiceoverSource;
  time: number;
  duration: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onClipChange: (id: string, patch: Partial<VoiceoverClip>) => void;
  onBlockMove: (id: string, start: number) => void;
  onOverlayChange: (id: string, start: number, end: number) => void;
}

const LABEL_W = 92;
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];

type Drag =
  | { kind: 'trim-in' | 'trim-out'; id: string; x0: number; orig: VoiceoverClip }
  | { kind: 'block'; id: string; x0: number; orig: number }
  | { kind: 'overlay' | 'overlay-end'; id: string; x0: number; s0: number; e0: number }
  | { kind: 'scrub' };

export function Timeline(p: Props) {
  const { timeline } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40);
  const drag = useRef<Drag | null>(null);
  const starts = useMemo(() => clipStarts(timeline), [timeline]);
  const width = Math.max(600, (p.duration + 5) * pps);
  const step = STEPS.find((s) => s * pps >= 70) ?? 120;

  // Fit the whole edit on first open.
  const fitted = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || fitted.current || p.duration <= 0) return;
    fitted.current = true;
    setPps(Math.max(4, Math.min(120, (el.clientWidth - LABEL_W - 40) / p.duration)));
  }, [p.duration]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = p.time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [p.time, pps]);

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
      const src_in = Math.max(0, Math.min(d.orig.src_out - 0.1, d.orig.src_in + dt * d.orig.speed));
      p.onClipChange(d.id, { src_in });
    } else if (d.kind === 'trim-out') {
      const src_out = Math.min(p.source.duration, Math.max(d.orig.src_in + 0.1, d.orig.src_out + dt * d.orig.speed));
      p.onClipChange(d.id, { src_out });
    } else if (d.kind === 'block') {
      p.onBlockMove(d.id, Math.max(0, d.orig + dt));
    } else if (d.kind === 'overlay') {
      const len = d.e0 - d.s0;
      const s = Math.max(0, Math.min(p.duration - len, d.s0 + dt));
      p.onOverlayChange(d.id, s, s + len);
    } else if (d.kind === 'overlay-end') {
      p.onOverlayChange(d.id, d.s0, Math.max(d.s0 + 0.3, Math.min(p.duration, d.e0 + dt)));
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

  return (
    <div className="flex h-full flex-col" style={{ background: '#0B0C11', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <span className="font-mono" style={{ color: '#E9E9F0' }}>{fmtTime(p.time)}</span>
        <span>/ {fmtTime(p.duration)}</span>
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
          {/* Ruler */}
          <div
            className="sticky top-0 z-10 flex h-6 cursor-pointer"
            style={{ background: '#0B0C11', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            onPointerDown={(e) => { begin(e, { kind: 'scrub' }); p.onSeek(xToTime(e.clientX)); }}
          >
            <div className="sticky left-0 z-20 shrink-0" style={{ width: LABEL_W, background: '#0B0C11' }} />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: t * pps, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                  <span className="ml-1 font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{fmtTime(t, false)}</span>
                </div>
              ))}
            </div>
          </div>

          <Track icon={<Film className="h-3.5 w-3.5" />} label="Video">
            {timeline.clips.map((c, i) => {
              const d = clipOutputDuration(c);
              const sel = p.selection?.kind === 'clip' && p.selection.id === c.id;
              return (
                <div
                  key={c.id}
                  className="absolute top-1 bottom-1 overflow-hidden rounded-md text-[10px]"
                  style={{ left: starts[i] * pps, width: Math.max(4, d * pps - 1), background: sel ? '#3B3270' : '#252640', border: `1px solid ${sel ? '#A78BFA' : 'rgba(255,255,255,0.12)'}`, color: '#E9E9F0' }}
                  onPointerDown={(e) => { e.stopPropagation(); p.onSelect({ kind: 'clip', id: c.id }); }}
                >
                  <div className="truncate px-2 pt-1">
                    {fmtTime(c.src_in)}–{fmtTime(c.src_out)}
                    {c.speed !== 1 ? <b className="ml-1" style={{ color: '#FCD34D' }}>{c.speed}×</b> : null}
                    {c.zoom.mode !== 'none' ? <span className="ml-1" style={{ color: '#7DD3FC' }}>⌕{c.zoom.scale.toFixed(1)}</span> : null}
                  </div>
                  <Handle side="left" onPointerDown={(e) => begin(e, { kind: 'trim-in', id: c.id, x0: e.clientX, orig: c })} />
                  <Handle side="right" onPointerDown={(e) => begin(e, { kind: 'trim-out', id: c.id, x0: e.clientX, orig: c })} />
                </div>
              );
            })}
          </Track>

          <Track icon={<Mic className="h-3.5 w-3.5" />} label="Voice">
            {timeline.blocks.map((b, i) => {
              const d = blockDuration(b);
              const next = timeline.blocks[i + 1];
              const overlaps = next ? b.start + d > next.start + 0.01 : b.start + d > p.duration + 0.01;
              const sel = p.selection?.kind === 'block' && p.selection.id === b.id;
              const state = !b.audio_url ? 'draft' : blockIsStale(b) ? 'stale' : 'ready';
              const bg = state === 'ready' ? '#0F3B33' : state === 'stale' ? '#3D3214' : '#1E2130';
              return (
                <div
                  key={b.id}
                  className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-[10px] active:cursor-grabbing"
                  style={{
                    left: b.start * pps,
                    width: Math.max(6, d * pps - 1),
                    background: bg,
                    border: `1px ${state === 'draft' ? 'dashed' : 'solid'} ${sel ? '#A78BFA' : overlaps ? '#F87171' : 'rgba(255,255,255,0.14)'}`,
                    color: '#E9E9F0',
                  }}
                  title={overlaps ? 'Overlaps the next block' : b.text}
                  onPointerDown={(e) => { p.onSelect({ kind: 'block', id: b.id }); begin(e, { kind: 'block', id: b.id, x0: e.clientX, orig: b.start }); }}
                >
                  {b.audio_url ? <Wave words={b.words} d={d} /> : null}
                  <div className="relative truncate px-2 pt-1">{b.text || <i style={{ opacity: 0.5 }}>empty</i>}</div>
                </div>
              );
            })}
          </Track>

          <Track icon={<Type className="h-3.5 w-3.5" />} label="Text">
            {timeline.overlays.map((o) => {
              const sel = p.selection?.kind === 'overlay' && p.selection.id === o.id;
              return (
                <div
                  key={o.id}
                  className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-[10px]"
                  style={{ left: o.start * pps, width: Math.max(6, (o.end - o.start) * pps - 1), background: '#2A1E3D', border: `1px solid ${sel ? '#A78BFA' : 'rgba(255,255,255,0.14)'}`, color: '#E9E9F0' }}
                  onPointerDown={(e) => { p.onSelect({ kind: 'overlay', id: o.id }); begin(e, { kind: 'overlay', id: o.id, x0: e.clientX, s0: o.start, e0: o.end }); }}
                >
                  <div className="truncate px-2 pt-1">{o.text}</div>
                  <Handle side="right" onPointerDown={(e) => { p.onSelect({ kind: 'overlay', id: o.id }); begin(e, { kind: 'overlay-end', id: o.id, x0: e.clientX, s0: o.start, e0: o.end }); }} />
                </div>
              );
            })}
          </Track>

          {/* Playhead */}
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
    <div className="flex h-14" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 px-3 text-[11px]" style={{ width: LABEL_W, background: '#0B0C11', color: 'rgba(255,255,255,0.55)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        {icon}{label}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function Handle({ side, onPointerDown }: { side: 'left' | 'right'; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20"
      style={{ [side]: 0, background: 'rgba(255,255,255,0.06)' }}
    />
  );
}

/** Word-timing bars (stand-in for a waveform; we have exact word timings from ElevenLabs). */
function Wave({ words, d }: { words: { start: number; end: number }[]; d: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 h-3">
      {words.map((w, i) => (
        <div key={i} className="absolute bottom-0 rounded-sm" style={{ left: `${(w.start / d) * 100}%`, width: `${Math.max(0.4, ((w.end - w.start) / d) * 100)}%`, height: `${40 + ((i * 37) % 60)}%`, background: 'rgba(52,211,153,0.55)' }} />
      ))}
    </div>
  );
}
