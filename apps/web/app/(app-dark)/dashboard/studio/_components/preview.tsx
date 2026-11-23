// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Live preview of a Voiceover Studio timeline, in the browser, with no render:
 * plays the source recording through the cut list (seeking between clips,
 * playbackRate = clip speed), applies the same zoom math as the ffmpeg render
 * (zoomAt / zoomWindow from @vantly-ugc/schema), plays each voice block's
 * audio at its position, and draws text animations + captions as DOM layers
 * that mirror the burned-in ASS.
 *
 * The parent owns the playhead (`time`) and `playing`; this component reports
 * time back through onTime while playing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clipOutputDuration,
  locateOutputTime,
  timelineDuration,
  timelineWords,
  zoomAt,
  zoomWindow,
  type TextOverlay,
  type VoiceoverSource,
  type VoiceoverTimeline,
} from '@vantly-ugc/schema';
import { clipStarts } from '../_lib/ops';

interface Props {
  source: VoiceoverSource;
  timeline: VoiceoverTimeline;
  time: number;
  playing: boolean;
  onTime: (t: number) => void;
  onEnded: () => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string) => void;
  onOverlayMove: (id: string, x: number, y: number) => void;
  /** When set, clicking the frame picks this clip's zoom focus point. */
  pickFocusFor: string | null;
  onFocusPick: (clipId: string, x: number, y: number) => void;
}

const CAPTION_WORDS = { hormozi: 3, tiktok: 5, minimal: 6 } as const;

function outputAspect(source: VoiceoverSource, aspect: VoiceoverTimeline['output']['aspect']): number {
  if (aspect === '16:9') return 16 / 9;
  if (aspect === '9:16') return 9 / 16;
  if (aspect === '1:1') return 1;
  return source.width / source.height;
}

export function Preview(p: Props) {
  const { source, timeline } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const clipIdx = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [loaded, setLoaded] = useState(false);

  const total = useMemo(() => timelineDuration(timeline), [timeline]);
  const starts = useMemo(() => clipStarts(timeline), [timeline]);
  const aspect = outputAspect(source, timeline.output.aspect);

  // Fit the output frame into the available space.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.width, r.height * aspect);
      setBox({ w, h: w / aspect });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Where the recording sits inside the frame.
  const content = useMemo(() => {
    const srcAspect = source.width / source.height;
    if (timeline.output.aspect === 'source' || timeline.output.fit === 'cover') {
      return { w: box.w, h: box.h, x: 0, y: 0, cover: timeline.output.aspect !== 'source' };
    }
    const w = Math.min(box.w, box.h * srcAspect);
    const h = w / srcAspect;
    return { w, h, x: (box.w - w) / 2, y: (box.h - h) / 2, cover: false };
  }, [box, source, timeline.output.aspect, timeline.output.fit]);

  const showBlur = timeline.output.fit === 'blur' && (content.w < box.w - 1 || content.h < box.h - 1);

  const drawBg = useCallback(() => {
    const v = videoRef.current;
    const c = bgRef.current;
    if (!v || !c || !showBlur || v.readyState < 2) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const w = v.videoWidth * s;
    const h = v.videoHeight * s;
    ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [showBlur]);

  // ── Voice audio ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = audios.current;
    const live = new Set<string>();
    for (const b of timeline.blocks) {
      if (!b.audio_url) continue;
      const key = `${b.id}|${b.audio_url}`;
      live.add(key);
      if (!map.has(key)) {
        const a = new Audio(b.audio_url);
        a.preload = 'auto';
        map.set(key, a);
      }
    }
    for (const [k, a] of map) if (!live.has(k)) { a.pause(); map.delete(k); }
  }, [timeline.blocks]);

  const syncAudio = useCallback((t: number, playing: boolean) => {
    for (const b of timeline.blocks) {
      if (!b.audio_url) continue;
      const a = audios.current.get(`${b.id}|${b.audio_url}`);
      if (!a) continue;
      a.volume = Math.min(1, b.volume);
      const local = t - b.start;
      const inside = local >= 0 && local < (b.audio_duration ?? a.duration ?? 0);
      if (playing && inside) {
        if (Math.abs(a.currentTime - local) > 0.25) a.currentTime = local;
        if (a.paused) void a.play().catch(() => {});
      } else if (!a.paused) {
        a.pause();
      }
    }
  }, [timeline.blocks]);

  useEffect(() => () => { for (const a of audios.current.values()) a.pause(); }, []);

  // ── Original audio ───────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const vol = timeline.output.original_volume;
    v.muted = vol <= 0;
    v.volume = Math.min(1, Math.max(0, vol));
  }, [timeline.output.original_volume]);

  // ── Scrub (paused) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (p.playing) return;
    const v = videoRef.current;
    if (!v || !loaded) return;
    const loc = locateOutputTime(timeline, Math.min(p.time, Math.max(0, total - 0.001)));
    if (!loc) return;
    clipIdx.current = loc.index;
    if (Math.abs(v.currentTime - loc.srcT) > 0.02) v.currentTime = loc.srcT;
    syncAudio(p.time, false);
  }, [p.time, p.playing, timeline, total, loaded, syncAudio]);

  // ── Play loop: the video element is the clock inside a clip ──────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !loaded) return;
    if (!p.playing) {
      v.pause();
      syncAudio(p.time, false);
      return;
    }
    let startAt = p.time >= total - 0.05 ? 0 : p.time;
    const loc = locateOutputTime(timeline, startAt);
    if (!loc) { p.onEnded(); return; }
    clipIdx.current = loc.index;
    v.currentTime = loc.srcT;
    v.playbackRate = timeline.clips[loc.index].speed;
    void v.play().catch(() => {});

    const tick = () => {
      const i = clipIdx.current;
      const c = timeline.clips[i];
      if (!c) return;
      if (v.currentTime >= c.src_out - 0.02) {
        const n = i + 1;
        if (n >= timeline.clips.length) {
          v.pause();
          syncAudio(total, false);
          p.onTime(total);
          p.onEnded();
          return;
        }
        clipIdx.current = n;
        v.currentTime = timeline.clips[n].src_in;
        v.playbackRate = timeline.clips[n].speed;
      }
      const cc = timeline.clips[clipIdx.current];
      const t = starts[clipIdx.current] + Math.max(0, v.currentTime - cc.src_in) / cc.speed;
      startAt = t;
      p.onTime(t);
      syncAudio(t, !v.paused || v.seeking);
      drawBg();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      v.pause();
    };
    // Restart the loop only when play state or the edit changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.playing, timeline, loaded]);

  // ── Derived visual state at the playhead ─────────────────────────────────
  const loc = locateOutputTime(timeline, Math.min(p.time, Math.max(0, total - 0.001)));
  const clip = loc ? timeline.clips[loc.index] : null;
  const zoom = clip && !p.pickFocusFor ? zoomAt(clip, p.time - (loc?.clipStart ?? 0)) : 1;
  const win = clip ? zoomWindow(zoom, clip.zoom.x, clip.zoom.y) : { x: 0, y: 0, size: 1 };

  const k = box.h / 1080;
  const fadeOpacity = (() => {
    if (!clip || !loc) return 1;
    const local = p.time - loc.clipStart;
    const d = clipOutputDuration(clip);
    let o = 1;
    if (clip.fade_in > 0) o = Math.min(o, local / Math.min(clip.fade_in, d / 2));
    if (clip.fade_out > 0) o = Math.min(o, (d - local) / Math.min(clip.fade_out, d / 2));
    return Math.max(0, Math.min(1, o));
  })();

  const captions = useMemo(() => {
    if (!timeline.output.captions.enabled) return [];
    const words = timelineWords(timeline);
    const n = CAPTION_WORDS[timeline.output.captions.style];
    const groups: { start: number; end: number; words: typeof words }[] = [];
    for (let i = 0; i < words.length; i += n) {
      const g = words.slice(i, i + n);
      groups.push({ start: g[0].start, end: g[g.length - 1].end, words: g });
    }
    return groups;
  }, [timeline]);
  const capGroup = captions.find((g) => p.time >= g.start && p.time < g.end + 0.15);

  // ── Overlay drag ─────────────────────────────────────────────────────────
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const onFramePointer = (e: React.PointerEvent) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    if (p.pickFocusFor) {
      const cx = (e.clientX - r.left - content.x) / content.w;
      const cy = (e.clientY - r.top - content.y) / content.h;
      if (cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1) p.onFocusPick(p.pickFocusFor, cx, cy);
      return;
    }
    if (dragRef.current && e.type === 'pointermove') {
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width - dragRef.current.dx));
      const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height - dragRef.current.dy));
      p.onOverlayMove(dragRef.current.id, x, y);
    }
  };

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div
        ref={frameRef}
        className="relative overflow-hidden"
        style={{ width: box.w, height: box.h, background: '#000', borderRadius: 6, cursor: p.pickFocusFor ? 'crosshair' : undefined, touchAction: 'none' }}
        onPointerDown={onFramePointer}
        onPointerMove={onFramePointer}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerLeave={() => { dragRef.current = null; }}
      >
        {showBlur ? (
          <canvas
            ref={bgRef}
            width={96}
            height={Math.round(96 / aspect)}
            className="absolute inset-0 h-full w-full"
            style={{ filter: 'blur(18px) brightness(0.92)', transform: 'scale(1.15)', opacity: fadeOpacity }}
          />
        ) : null}

        <div className="absolute overflow-hidden" style={{ left: content.x, top: content.y, width: content.w, height: content.h, opacity: fadeOpacity }}>
          <video
            ref={videoRef}
            src={source.url}
            playsInline
            preload="auto"
            muted
            onLoadedData={() => { setLoaded(true); drawBg(); }}
            onSeeked={drawBg}
            style={{
              width: content.w,
              height: content.h,
              objectFit: content.cover ? 'cover' : 'fill',
              transformOrigin: '0 0',
              transform: zoom > 1.0005 ? `scale(${zoom}) translate(${-win.x * content.w}px, ${-win.y * content.h}px)` : undefined,
              display: 'block',
            }}
          />
          {p.pickFocusFor ? (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-3" style={{ background: 'rgba(167,139,250,0.12)', outline: '2px dashed #A78BFA', outlineOffset: -2 }}>
              <span className="rounded-md px-2 py-1 text-xs" style={{ background: '#14151F', color: '#E9E9F0' }}>Click where the zoom should focus</span>
            </div>
          ) : null}
        </div>

        {timeline.overlays.map((o) => (
          <OverlayView
            key={o.id}
            o={o}
            t={p.time}
            k={k}
            selected={o.id === p.selectedOverlayId}
            onPointerDown={(e) => {
              if (p.pickFocusFor) return;
              e.stopPropagation();
              p.onSelectOverlay(o.id);
              const r = frameRef.current!.getBoundingClientRect();
              dragRef.current = { id: o.id, dx: (e.clientX - r.left) / r.width - o.x, dy: (e.clientY - r.top) / r.height - o.y };
            }}
          />
        ))}

        {capGroup ? <CaptionView group={capGroup} t={p.time} style={timeline.output.captions.style} k={k} box={box} /> : null}

        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Loading recording…</div>
        ) : null}
      </div>
    </div>
  );
}

/** Mirrors buildOverlayAss() animation timing so the preview matches the render. */
function overlayAnim(o: TextOverlay, t: number, k: number): { opacity: number; dy: number; scale: number } | null {
  if (t < o.start || t >= o.end) return null;
  const lt = t - o.start;
  const dur = o.end - o.start;
  const f = Math.min(0.25, dur / 3);
  const fade = Math.max(0, Math.min(1, lt / f, (dur - lt) / f));
  switch (o.animation) {
    case 'fade': return { opacity: fade, dy: 0, scale: 1 };
    case 'slide_up': return { opacity: fade, dy: 48 * k * (1 - Math.min(lt / Math.min(0.4, dur), 1)), scale: 1 };
    case 'pop': {
      const a = Math.min(0.18, dur);
      const b = Math.min(0.3, dur);
      const scale = lt < a ? 0.3 + 0.8 * (lt / a) : lt < b ? 1.1 - 0.1 * ((lt - a) / Math.max(0.001, b - a)) : 1;
      return { opacity: Math.max(0, Math.min(1, (dur - lt) / f)), dy: 0, scale };
    }
    default: return { opacity: 1, dy: 0, scale: 1 };
  }
}

function OverlayView({ o, t, k, selected, onPointerDown }: { o: TextOverlay; t: number; k: number; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const a = overlayAnim(o, t, k);
  if (!a) return null;
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute select-none whitespace-pre text-center font-bold"
      style={{
        left: `${o.x * 100}%`,
        top: `${o.y * 100}%`,
        transform: `translate(-50%, calc(-50% + ${a.dy}px)) scale(${a.scale})`,
        opacity: a.opacity,
        fontSize: o.size * k,
        lineHeight: 1.15,
        fontFamily: '"Liberation Sans", Arial, Helvetica, sans-serif',
        color: o.color,
        background: o.box ? o.box_color : undefined,
        padding: o.box ? `${2 * k}px ${14 * k}px` : undefined,
        textShadow: o.box ? undefined : `0 0 ${3 * k}px #000, 0 ${2 * k}px ${2 * k}px rgba(0,0,0,0.6)`,
        outline: selected ? '1.5px dashed #A78BFA' : undefined,
        outlineOffset: 4,
        cursor: 'move',
      }}
    >
      {o.text}
    </div>
  );
}

function CaptionView({ group, t, style, k, box }: {
  group: { words: { word: string; start: number; end: number }[] };
  t: number;
  style: 'hormozi' | 'tiktok' | 'minimal';
  k: number;
  box: { w: number; h: number };
}) {
  // Caption layout presets are authored for 1080-wide (9:16) or 1080-tall frames.
  const scale = box.w < box.h ? box.w / 1080 : k;
  const s = style === 'hormozi'
    ? { size: 80, top: true, margin: 200, upper: true, bold: true, box: false }
    : style === 'tiktok'
      ? { size: 64, top: false, margin: 220, upper: false, bold: true, box: true }
      : { size: 52, top: false, margin: 140, upper: false, bold: false, box: false };
  const margin = (box.w > box.h ? s.margin * 0.6 : s.margin) * scale;
  return (
    <div
      className="pointer-events-none absolute left-1/2 max-w-[90%] -translate-x-1/2 text-center"
      style={{
        [s.top ? 'top' : 'bottom']: margin,
        fontSize: s.size * scale,
        fontWeight: s.bold ? 700 : 400,
        fontFamily: '"Liberation Sans", Arial, sans-serif',
        color: '#fff',
        textTransform: s.upper ? 'uppercase' : undefined,
        background: s.box ? 'rgba(0,0,0,0.5)' : undefined,
        padding: s.box ? `${4 * scale}px ${12 * scale}px` : undefined,
        textShadow: s.box ? undefined : `0 0 ${3 * scale}px rgba(0,0,0,0.95), 0 ${2 * scale}px ${5 * scale}px rgba(0,0,0,0.85)`,
        WebkitTextStroke: s.box ? undefined : `${Math.max(0.5, 1.2 * scale)}px rgba(0,0,0,0.85)`,
        paintOrder: 'stroke fill',
        lineHeight: 1.2,
      }}
    >
      {group.words.map((w, i) => (
        <span key={i} style={{ color: style === 'hormozi' && t >= w.start && t < w.end + 0.05 ? '#FFFF00' : undefined }}>
          {w.word}{i < group.words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </div>
  );
}
