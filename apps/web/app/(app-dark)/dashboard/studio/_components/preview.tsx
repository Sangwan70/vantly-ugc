// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Live preview of a Voiceover Studio timeline in the browser — no render.
 * Mirrors the ffmpeg render: camera (zoom / keyframes via clipCameraAt), title
 * cards, transition dips, effects (click, spotlight, highlight, arrow,
 * redaction), overlays (text, lower third, callout, typewriter), the caption
 * style engine (resolveCaptionStyle + captionLines), logo, AI badge, custom
 * fonts, voice blocks (with take trims) and music that ducks under narration.
 *
 * The parent owns the playhead (`time`) and `playing`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  blockAudioLength,
  captionLines,
  clipCameraAt,
  clipOutputDuration,
  locateOutputTime,
  resolveCaptionStyle,
  timelineDuration,
  timelineWords,
  transitionOverlap,
  zoomWindow,
  type TextOverlay,
  type VoiceoverCard,
  type VoiceoverEffect,
  type VoiceoverTimeline,
} from '@vantly-ugc/schema';
import { clipStarts } from '../_lib/ops';
import type { StudioSource } from '../_lib/api';

export interface PickMode {
  /** content = coordinates inside the recording (zoom focus); frame = output frame (effects, text). */
  space: 'content' | 'frame';
  label: string;
  onPick: (x: number, y: number) => void;
}

interface Props {
  source: StudioSource;
  timeline: VoiceoverTimeline;
  time: number;
  playing: boolean;
  onTime: (t: number) => void;
  onEnded: () => void;
  selectedId: string | null;
  onSelect: (kind: 'overlay' | 'effect', id: string) => void;
  onOverlayMove: (id: string, x: number, y: number) => void;
  onEffectMove: (id: string, x: number, y: number) => void;
  pick: PickMode | null;
}

const BUILTIN = '"Liberation Sans", Arial, Helvetica, sans-serif';

function outputAspect(source: StudioSource, aspect: VoiceoverTimeline['output']['aspect']): number {
  if (aspect === '16:9') return 16 / 9;
  if (aspect === '9:16') return 9 / 16;
  if (aspect === '1:1') return 1;
  return source.width / source.height;
}

export function Preview(p: Props) {
  const { source, timeline } = p;
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const clipIdx = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [loaded, setLoaded] = useState(false);

  const total = useMemo(() => timelineDuration(timeline), [timeline]);
  const starts = useMemo(() => clipStarts(timeline), [timeline]);
  const aspect = outputAspect(source, timeline.output.aspect);
  const videoSrc = source.proxy_url ?? source.url;

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

  // Custom fonts: registered under their asset id.
  useEffect(() => {
    for (const f of timeline.fonts) {
      if ([...document.fonts].some((ff) => ff.family === f.id)) continue;
      const face = new FontFace(f.id, `url(${f.url})`);
      void face.load().then((ff) => document.fonts.add(ff)).catch(() => {});
    }
  }, [timeline.fonts]);
  const fontCss = useCallback((ref: string) => (timeline.fonts.some((f) => f.id === ref) ? `"${ref}", ${BUILTIN}` : ref && ref !== 'Liberation Sans' ? `"${ref}", ${BUILTIN}` : BUILTIN), [timeline.fonts]);

  const content = useMemo(() => {
    const srcAspect = source.width / source.height;
    if (timeline.output.aspect === 'source' || timeline.output.fit === 'cover') return { w: box.w, h: box.h, x: 0, y: 0, cover: timeline.output.aspect !== 'source' };
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
    ctx.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
  }, [showBlur]);

  // ── Audio: voice blocks + music ──────────────────────────────────────────
  useEffect(() => {
    const map = audios.current;
    const live = new Set<string>();
    for (const b of timeline.blocks) {
      if (!b.audio_url) continue;
      const key = `${b.id}|${b.audio_url}`;
      live.add(key);
      if (!map.has(key)) { const a = new Audio(b.audio_url); a.preload = 'auto'; map.set(key, a); }
    }
    for (const [k, a] of map) if (!live.has(k)) { a.pause(); map.delete(k); }
  }, [timeline.blocks]);

  useEffect(() => {
    const m = timeline.audio.music;
    if (!m) { musicRef.current?.pause(); musicRef.current = null; return; }
    if (!musicRef.current || musicRef.current.src !== m.url) {
      musicRef.current?.pause();
      musicRef.current = new Audio(m.url);
      musicRef.current.loop = m.loop;
      musicRef.current.preload = 'auto';
    }
  }, [timeline.audio.music]);

  const syncAudio = useCallback((t: number, playing: boolean) => {
    let speaking = false;
    for (const b of timeline.blocks) {
      if (!b.audio_url) continue;
      const a = audios.current.get(`${b.id}|${b.audio_url}`);
      if (!a) continue;
      a.volume = Math.min(1, b.volume);
      const local = t - b.start;
      const len = b.audio_duration ? blockAudioLength(b) : a.duration || 0;
      const inside = local >= 0 && local < len;
      if (inside) speaking = true;
      if (playing && inside) {
        const want = (b.audio_in ?? 0) + local;
        if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
        if (a.paused) void a.play().catch(() => {});
      } else if (!a.paused) a.pause();
    }
    const m = timeline.audio.music;
    const mu = musicRef.current;
    if (m && mu) {
      const fadeIn = m.fade_in > 0 ? Math.min(1, t / m.fade_in) : 1;
      const fadeOut = m.fade_out > 0 ? Math.min(1, (total - t) / m.fade_out) : 1;
      const duck = m.duck && speaking ? 1 - 0.85 * m.duck_amount : 1;
      mu.volume = Math.max(0, Math.min(1, m.volume * fadeIn * fadeOut * duck));
      if (playing && t < total) {
        const want = mu.duration ? t % mu.duration : t;
        if (Math.abs(mu.currentTime - want) > 0.4) mu.currentTime = want;
        if (mu.paused) void mu.play().catch(() => {});
      } else if (!mu.paused) mu.pause();
    }
  }, [timeline.blocks, timeline.audio.music, total]);

  useEffect(() => () => { for (const a of audios.current.values()) a.pause(); musicRef.current?.pause(); }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = timeline.output.original_volume <= 0;
    v.volume = Math.min(1, Math.max(0, timeline.output.original_volume));
  }, [timeline.output.original_volume]);

  // ── Scrub (paused) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (p.playing) return;
    const v = videoRef.current;
    if (!v || !loaded) return;
    const loc = locateOutputTime(timeline, Math.min(p.time, Math.max(0, total - 0.001)));
    if (!loc) return;
    clipIdx.current = loc.index;
    if (timeline.clips[loc.index].kind !== 'card' && Math.abs(v.currentTime - loc.srcT) > 0.02) v.currentTime = loc.srcT;
    syncAudio(p.time, false);
  }, [p.time, p.playing, timeline, total, loaded, syncAudio]);

  // ── Play loop: a wall clock drives cards; the video drives source clips ─
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !loaded) return;
    if (!p.playing) { v.pause(); syncAudio(p.time, false); return; }
    const startAt = p.time >= total - 0.05 ? 0 : p.time;
    const first = locateOutputTime(timeline, startAt);
    if (!first) { p.onEnded(); return; }
    let t = startAt;
    let last = performance.now();
    const enter = (i: number, srcT?: number) => {
      clipIdx.current = i;
      const c = timeline.clips[i];
      if (c.kind === 'card') { v.pause(); return; }
      v.currentTime = srcT ?? c.src_in;
      v.playbackRate = c.speed;
      void v.play().catch(() => {});
    };
    enter(first.index, first.srcT);
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const i = clipIdx.current;
      const c = timeline.clips[i];
      if (!c) return;
      if (c.kind === 'card') t += dt;
      else if (!v.seeking) t = starts[i] + Math.max(0, v.currentTime - c.src_in) / c.speed;
      const end = starts[i] + clipOutputDuration(c);
      const nextStart = starts[i + 1];
      if (i + 1 < timeline.clips.length && t >= nextStart) {
        enter(i + 1, timeline.clips[i + 1].kind === 'card' ? undefined : timeline.clips[i + 1].src_in + (t - nextStart) * timeline.clips[i + 1].speed);
      } else if (t >= end - 0.02 && i + 1 >= timeline.clips.length) {
        v.pause();
        syncAudio(total, false);
        p.onTime(total);
        p.onEnded();
        return;
      }
      p.onTime(Math.min(t, total));
      syncAudio(t, true);
      drawBg();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); v.pause(); };
    // Restart only when play state or the edit changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.playing, timeline, loaded]);

  // ── Visual state at the playhead ─────────────────────────────────────────
  const loc = locateOutputTime(timeline, Math.min(p.time, Math.max(0, total - 0.001)));
  const clip = loc ? timeline.clips[loc.index] : null;
  const local = loc ? p.time - loc.clipStart : 0;
  const cam = clip && clip.kind !== 'card' && !(p.pick?.space === 'content') ? clipCameraAt(clip, local) : { zoom: 1, x: 0.5, y: 0.5 };
  const win = zoomWindow(cam.zoom, cam.x, cam.y);
  const k = box.h / 1080;

  // Cover (9:16 / 1:1 from a wider recording): mirror the render — a canvas-shaped
  // window follows the camera's focus, and the camera only zooms past what that
  // window already shows. See coverChain() in the worker.
  const cover = (() => {
    if (!content.cover) return null;
    const srcAspect = source.width / source.height;
    const fw = srcAspect >= box.w / box.h ? box.h * srcAspect : box.w;
    const fh = fw / srcAspect;
    const c = Math.max(fw / box.w, fh / box.h);
    const ox = Math.max(0, Math.min(fw - box.w, cam.x * fw - box.w / 2));
    const oy = Math.max(0, Math.min(fh - box.h, cam.y * fh - box.h / 2));
    const zp = Math.max(1, cam.zoom / c);
    const zx = Math.max(0, Math.min(box.w - box.w / zp, ((cam.x * fw - ox) / box.w) * box.w - box.w / zp / 2));
    const zy = Math.max(0, Math.min(box.h - box.h / zp, ((cam.y * fh - oy) / box.h) * box.h - box.h / zp / 2));
    return { fw, fh, ox, oy, zp, zx, zy };
  })();
  // Where effects (authored on the recording as the 16:9 cut frames it) land on screen.
  const fxRect = cover
    ? { x: (win.x * cover.fw - cover.ox - cover.zx) * cover.zp, y: (win.y * cover.fh - cover.oy - cover.zy) * cover.zp, w: (cover.fw / Math.max(1, cam.zoom)) * cover.zp, h: (cover.fh / Math.max(1, cam.zoom)) * cover.zp }
    : { x: content.x, y: content.y, w: content.w, h: content.h };

  const fade = (() => {
    if (!clip || !loc) return 1;
    const d = clipOutputDuration(clip);
    let o = 1;
    if (clip.fade_in > 0) o = Math.min(o, local / Math.min(clip.fade_in, d / 2));
    if (clip.fade_out > 0) o = Math.min(o, (d - local) / Math.min(clip.fade_out, d / 2));
    // Transition into this clip: approximate any kind as a quick dip.
    const ov = transitionOverlap(timeline, loc.index);
    if (ov > 0 && local < ov) o = Math.min(o, 0.25 + 0.75 * (local / ov));
    const nextOv = loc.index + 1 < timeline.clips.length ? transitionOverlap(timeline, loc.index + 1) : 0;
    if (nextOv > 0 && d - local < nextOv) o = Math.min(o, 0.25 + 0.75 * ((d - local) / nextOv));
    return Math.max(0, Math.min(1, o));
  })();

  const captions = useMemo(() => {
    if (!timeline.output.captions.enabled) return { lines: [] as ReturnType<typeof captionLines>, style: resolveCaptionStyle(timeline.output.captions) };
    const style = resolveCaptionStyle(timeline.output.captions);
    return { lines: captionLines(timelineWords(timeline), style.words_per_line), style };
  }, [timeline]);
  const capLine = captions.lines.find((l) => p.time >= l.start && p.time < l.end + 0.12);

  // ── Pointer: pick mode + drag overlays/effects ───────────────────────────
  const drag = useRef<{ kind: 'overlay' | 'effect'; id: string; dx: number; dy: number } | null>(null);
  // Overlays live in frame space (0..1 of the preview); effects in the recording's space.
  const toSpace = (kind: 'overlay' | 'effect', px: number, py: number, r: DOMRect) => {
    const sx = px * (box.w / r.width);
    const sy = py * (box.h / r.height);
    return kind === 'effect' ? { x: (sx - fxRect.x) / fxRect.w, y: (sy - fxRect.y) / fxRect.h } : { x: sx / box.w, y: sy / box.h };
  };
  const onPointer = (e: React.PointerEvent) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    if (p.pick && e.type === 'pointerdown') {
      if (p.pick.space === 'content') {
        const x = (e.clientX - r.left - content.x) / content.w;
        const y = (e.clientY - r.top - content.y) / content.h;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) p.pick.onPick(x, y);
      } else {
        p.pick.onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      }
      return;
    }
    if (drag.current && e.type === 'pointermove') {
      const pt = toSpace(drag.current.kind, e.clientX - r.left, e.clientY - r.top, r);
      const x = Math.max(0, Math.min(1, pt.x - drag.current.dx));
      const y = Math.max(0, Math.min(1, pt.y - drag.current.dy));
      if (drag.current.kind === 'overlay') p.onOverlayMove(drag.current.id, x, y);
      else p.onEffectMove(drag.current.id, x, y);
    }
  };
  const startDrag = (e: React.PointerEvent, kind: 'overlay' | 'effect', id: string, x: number, y: number) => {
    if (p.pick) return;
    e.stopPropagation();
    p.onSelect(kind, id);
    const r = frameRef.current!.getBoundingClientRect();
    const pt = toSpace(kind, e.clientX - r.left, e.clientY - r.top, r);
    drag.current = { kind, id, dx: pt.x - x, dy: pt.y - y };
  };

  const branding = timeline.branding;
  const logoW = box.w * branding.logo_size;
  const m = Math.min(box.w, box.h) * 0.03;
  const corner = (pos: 'tl' | 'tr' | 'bl' | 'br') => ({
    [pos.startsWith('t') ? 'top' : 'bottom']: m,
    [pos.endsWith('l') ? 'left' : 'right']: m,
  });

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div
        ref={frameRef}
        className="relative select-none overflow-hidden"
        style={{ width: box.w, height: box.h, background: '#000', borderRadius: 6, cursor: p.pick ? 'crosshair' : undefined, touchAction: 'none' }}
        onPointerDown={onPointer}
        onPointerMove={onPointer}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
      >
        {showBlur && clip?.kind !== 'card' ? (
          <canvas ref={bgRef} width={96} height={Math.round(96 / aspect)} className="absolute inset-0 h-full w-full" style={{ filter: 'blur(18px) brightness(0.92)', transform: 'scale(1.15)', opacity: fade }} />
        ) : null}

        <div className="absolute overflow-hidden" style={{ left: content.x, top: content.y, width: content.w, height: content.h, opacity: clip?.kind === 'card' ? 0 : fade }}>
          <video
            ref={videoRef}
            src={videoSrc}
            playsInline
            preload="auto"
            muted
            onLoadedData={() => { setLoaded(true); drawBg(); }}
            onSeeked={drawBg}
            style={{
              width: cover ? cover.fw : content.w,
              height: cover ? cover.fh : content.h,
              objectFit: 'fill',
              transformOrigin: '0 0',
              transform: cover
                ? `scale(${cover.zp}) translate(${-(cover.ox + cover.zx)}px, ${-(cover.oy + cover.zy)}px)`
                : cam.zoom > 1.0005 ? `scale(${cam.zoom}) translate(${-win.x * content.w}px, ${-win.y * content.h}px)` : undefined,
              display: 'block',
            }}
          />
        </div>

        {clip?.kind === 'card' && clip.card ? <CardView card={clip.card} t={local} k={k} logo={branding.logo_url} opacity={fade} font={fontCss(timeline.overlays[0]?.font ?? '')} /> : null}

        {p.pick?.space === 'content' ? (
          <div className="pointer-events-none absolute" style={{ left: content.x, top: content.y, width: content.w, height: content.h, background: 'rgba(167,139,250,0.12)', outline: '2px dashed #A78BFA', outlineOffset: -2 }} />
        ) : null}

        <EffectsLayer effects={timeline.effects} t={p.time} w={box.w} h={box.h} rect={fxRect} scale={cover ? Math.min(box.w, box.h) / 1080 : undefined} selectedId={p.selectedId} onDrag={(e, fx) => startDrag(e, 'effect', fx.id, fx.x, fx.y)} />

        {timeline.overlays.map((o) => (
          <OverlayView key={o.id} o={o} t={p.time} k={k} w={box.w} h={box.h} font={fontCss(o.font)} selected={o.id === p.selectedId} onPointerDown={(e) => startDrag(e, 'overlay', o.id, o.x, o.y)} />
        ))}

        {capLine ? <CaptionView line={capLine} t={p.time} style={captions.style} box={box} font={fontCss(captions.style.font)} /> : null}

        {branding.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logo_url} alt="" className="pointer-events-none absolute" style={{ ...corner(branding.logo_position), width: logoW, opacity: branding.logo_opacity }} />
        ) : null}
        {branding.disclosure_badge ? (
          <div className="pointer-events-none absolute rounded px-1.5 py-0.5 font-bold" style={{ ...corner(branding.logo_position === 'tr' ? 'tl' : 'tr'), fontSize: Math.max(8, 22 * k), background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
            AI-generated voice
          </div>
        ) : null}

        {p.pick ? (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-md px-2 py-1 text-xs" style={{ background: '#14151F', color: '#E9E9F0' }}>{p.pick.label}</div>
        ) : null}
        {!loaded ? <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Loading recording…</div> : null}
      </div>
    </div>
  );
}

function CardView({ card, t, k, logo, opacity, font }: { card: VoiceoverCard; t: number; k: number; logo: string | null; opacity: number; font: string }) {
  const anim = (delay: number) => {
    const p = Math.max(0, Math.min(1, (t - delay) / 0.45));
    if (card.animation === 'pop') return { opacity: Math.min(1, p * 4), transform: `scale(${p < 0.5 ? 0.4 + 1.36 * p : 1.08 - 0.16 * (p - 0.5)})` };
    if (card.animation === 'fade') return { opacity: p, transform: 'none' };
    return { opacity: p, transform: `translateY(${(1 - p) * 40 * k}px)` };
  };
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" style={{ background: card.bg, opacity, fontFamily: font }}>
      {card.logo && logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: '14%', position: 'absolute', top: '16%' }} />
      ) : null}
      <div style={{ width: '12%', height: Math.max(2, 8 * k), background: card.accent, marginBottom: 24 * k, ...anim(0) }} />
      {card.title ? <div style={{ fontSize: 84 * k, fontWeight: 700, color: card.color, lineHeight: 1.1, ...anim(0.12) }}>{card.title}</div> : null}
      {card.subtitle ? <div style={{ fontSize: 40 * k, color: card.color, marginTop: 14 * k, ...anim(0.3), opacity: 0.85 * anim(0.3).opacity }}>{card.subtitle}</div> : null}
    </div>
  );
}

/** Same geometry as arrowPath() in the renderer. */
function arrowPoints(x0: number, y0: number, x1: number, y1: number, width: number): string {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const head = Math.min(len * 0.45, width * 3.2), hw = width * 1.6, sw = width / 2;
  const bx = x1 - ux * head, by = y1 - uy * head;
  return [[x0 + nx * sw, y0 + ny * sw], [bx + nx * sw, by + ny * sw], [bx + nx * hw, by + ny * hw], [x1, y1], [bx - nx * hw, by - ny * hw], [bx - nx * sw, by - ny * sw], [x0 - nx * sw, y0 - ny * sw]]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function EffectsLayer({ effects, t, w, h, rect, scale, selectedId, onDrag }: { effects: VoiceoverEffect[]; t: number; w: number; h: number; rect: { x: number; y: number; w: number; h: number }; scale?: number; selectedId: string | null; onDrag: (e: React.PointerEvent, fx: VoiceoverEffect) => void }) {
  const k = scale ?? rect.h / 1080;
  const live = effects.filter((e) => t >= e.start && t < e.end);
  if (!live.length) return null;
  return (
    <>
      {live.filter((e) => e.kind === 'blur').map((e) => (
        <div key={e.id} onPointerDown={(ev) => onDrag(ev, e)} className="absolute"
          style={{ left: rect.x + (e.x - e.w / 2) * rect.w, top: rect.y + (e.y - e.h / 2) * rect.h, width: e.w * rect.w, height: e.h * rect.h, backdropFilter: `blur(${6 + 10 * e.intensity}px)`, WebkitBackdropFilter: `blur(${6 + 10 * e.intensity}px)`, outline: e.id === selectedId ? '1.5px dashed #A78BFA' : undefined, cursor: 'move' }} />
      ))}
      <svg className="absolute inset-0" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {live.map((e) => {
          const lt = t - e.start;
          const dur = e.end - e.start;
          const f = Math.min(0.2, dur / 3);
          const op = Math.max(0, Math.min(1, lt / f, (dur - lt) / f));
          const x = rect.x + e.x * rect.w, y = rect.y + e.y * rect.h, bw = e.w * rect.w, bh = e.h * rect.h;
          const sel = e.id === selectedId;
          if (e.kind === 'click') {
            const p = Math.min(1, lt / 0.6);
            const r = (26 + 40 * e.intensity) * k * (0.35 + 1.25 * p);
            return (
              <g key={e.id} onPointerDown={(ev) => onDrag(ev, e)} style={{ cursor: 'move' }}>
                <circle cx={x} cy={y} r={r} fill="none" stroke={e.color} strokeWidth={Math.max(2, 5 * k)} opacity={lt < 0.7 ? 1 - p : 0} />
                <circle cx={x} cy={y} r={9 * k} fill={e.color} fillOpacity={0.75 * op} stroke="#000" strokeWidth={Math.max(1, 2 * k)} />
                {sel ? <circle cx={x} cy={y} r={20 * k} fill="none" stroke="#A78BFA" strokeDasharray="4 3" /> : null}
              </g>
            );
          }
          if (e.kind === 'spotlight') {
            const x0 = Math.max(0, x - bw / 2), y0 = Math.max(0, y - bh / 2);
            return (
              <path key={e.id} fillRule="evenodd" onPointerDown={(ev) => onDrag(ev, e)}
                d={`M0 0H${w}V${h}H0Z M${x0} ${y0}V${y0 + bh}H${x0 + bw}V${y0}Z`} fill="#000" fillOpacity={(0.25 + 0.6 * e.intensity) * op}
                stroke={sel ? '#A78BFA' : 'none'} strokeDasharray="4 3" style={{ cursor: 'move' }} />
            );
          }
          if (e.kind === 'highlight') {
            return <rect key={e.id} onPointerDown={(ev) => onDrag(ev, e)} x={x - bw / 2} y={y - bh / 2} width={bw} height={bh} fill={e.color} fillOpacity={0.18 * e.intensity * op} stroke={sel ? '#A78BFA' : e.color} strokeOpacity={op} strokeWidth={Math.max(2, 5 * k)} style={{ cursor: 'move' }} />;
          }
          if (e.kind === 'arrow') {
            return <polygon key={e.id} onPointerDown={(ev) => onDrag(ev, e)} points={arrowPoints(rect.x + e.from_x * rect.w, rect.y + e.from_y * rect.h, x, y, Math.max(6, 12 * k))} fill={e.color} fillOpacity={op} stroke={sel ? '#A78BFA' : '#000'} strokeWidth={Math.max(1, 3 * k)} style={{ cursor: 'move' }} />;
          }
          return null;
        })}
      </svg>
    </>
  );
}

/** Mirrors buildOverlayAss() animation timing so the preview matches the render. */
function overlayAnim(o: TextOverlay, t: number, k: number): { opacity: number; dx: number; dy: number; scale: number; text: string } | null {
  if (t < o.start || t >= o.end) return null;
  const lt = t - o.start;
  const dur = o.end - o.start;
  const f = Math.min(0.25, dur / 3);
  const fade = Math.max(0, Math.min(1, lt / f, (dur - lt) / f));
  const move = (px: number, ms = 0.4) => px * k * (1 - Math.min(lt / Math.min(ms, dur), 1));
  if (o.kind === 'lower_third') return { opacity: fade, dx: -move(60, 0.45), dy: 0, scale: 1, text: o.text };
  switch (o.animation) {
    case 'fade': return { opacity: fade, dx: 0, dy: 0, scale: 1, text: o.text };
    case 'slide_up': return { opacity: fade, dx: 0, dy: move(48), scale: 1, text: o.text };
    case 'slide_left': return { opacity: fade, dx: move(80), dy: 0, scale: 1, text: o.text };
    case 'typewriter': {
      const steps = Math.ceil(o.text.length / 2);
      const stepS = Math.min(1 / 15, dur / Math.max(1, steps) / 2);
      return { opacity: 1, dx: 0, dy: 0, scale: 1, text: o.text.slice(0, Math.min(o.text.length, (Math.floor(lt / stepS) + 1) * 2)) };
    }
    case 'pop': {
      const a = Math.min(0.18, dur), b = Math.min(0.3, dur);
      const scale = lt < a ? 0.3 + 0.8 * (lt / a) : lt < b ? 1.1 - 0.1 * ((lt - a) / Math.max(0.001, b - a)) : 1;
      return { opacity: Math.max(0, Math.min(1, (dur - lt) / f)), dx: 0, dy: 0, scale, text: o.text };
    }
    default: return { opacity: 1, dx: 0, dy: 0, scale: 1, text: o.text };
  }
}

function OverlayView({ o, t, k, w, h, font, selected, onPointerDown }: { o: TextOverlay; t: number; k: number; w: number; h: number; font: string; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const a = overlayAnim(o, t, k);
  if (!a) return null;
  const outline = selected ? '1.5px dashed #A78BFA' : undefined;
  if (o.kind === 'lower_third') {
    return (
      <div onPointerDown={onPointerDown} className="absolute flex" style={{ left: o.x * w + a.dx, top: o.y * h, transform: 'translateY(-50%)', opacity: a.opacity, outline, cursor: 'move', fontFamily: font }}>
        <div style={{ width: Math.max(3, 8 * k), background: o.color }} />
        <div style={{ background: o.box_color, padding: `${8 * k}px ${24 * k}px ${8 * k}px ${16 * k}px` }}>
          <div style={{ fontSize: o.size * k, fontWeight: 700, color: o.color, lineHeight: 1.15, whiteSpace: 'pre' }}>{o.text}</div>
          {o.subtitle ? <div style={{ fontSize: o.size * 0.55 * k, color: o.color, opacity: 0.82, whiteSpace: 'pre' }}>{o.subtitle}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <>
      {o.kind === 'callout' ? (
        <svg className="pointer-events-none absolute inset-0" width={w} height={h} style={{ opacity: a.opacity }}>
          <polygon points={arrowPoints(o.x * w, o.y * h, o.tx * w, o.ty * h, Math.max(5, 9 * k))} fill={o.box ? o.box_color : o.color} stroke="#000" strokeWidth={Math.max(1, 2 * k)} />
        </svg>
      ) : null}
      <div
        onPointerDown={onPointerDown}
        className="absolute whitespace-pre text-center font-bold"
        style={{
          left: `${o.x * 100}%`,
          top: `${o.y * 100}%`,
          transform: `translate(calc(-50% + ${a.dx}px), calc(-50% + ${a.dy}px)) scale(${a.scale})`,
          opacity: a.opacity,
          fontSize: o.size * k,
          lineHeight: 1.15,
          fontFamily: font,
          color: o.color,
          background: o.box ? o.box_color : undefined,
          padding: o.box ? `${2 * k}px ${14 * k}px` : undefined,
          textShadow: o.box ? undefined : `0 0 ${3 * k}px #000, 0 ${2 * k}px ${2 * k}px rgba(0,0,0,0.6)`,
          outline,
          outlineOffset: 4,
          cursor: 'move',
        }}
      >
        {a.text}
        {o.animation === 'typewriter' ? <span style={{ opacity: 0 }}>{o.text.slice(a.text.length)}</span> : null}
      </div>
    </>
  );
}

function CaptionView({ line, t, style: c, box, font }: {
  line: { words: { word: string; start: number; end: number }[] };
  t: number;
  style: ReturnType<typeof resolveCaptionStyle>;
  box: { w: number; h: number };
  font: string;
}) {
  const scale = box.w < box.h ? box.w / 1080 : box.h / 1080;
  const margin = c.margin * box.h;
  const pos = c.position === 'middle' ? { top: '50%', transform: 'translate(-50%, -50%)' } : c.position === 'top' ? { top: margin, transform: 'translateX(-50%)' } : { bottom: margin, transform: 'translateX(-50%)' };
  const hexA = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  return (
    <div
      className="pointer-events-none absolute left-1/2 max-w-[90%] text-center"
      style={{
        ...pos,
        fontSize: c.size * scale,
        fontWeight: c.bold ? 700 : 400,
        fontFamily: font,
        color: c.color,
        textTransform: c.uppercase ? 'uppercase' : undefined,
        background: c.box ? hexA(c.box_color, c.box_opacity) : undefined,
        padding: c.box ? `${4 * scale}px ${12 * scale}px` : undefined,
        textShadow: c.box ? undefined : `0 0 ${3 * scale}px rgba(0,0,0,0.95), 0 ${2 * scale}px ${5 * scale}px rgba(0,0,0,0.85)`,
        lineHeight: 1.2,
      }}
    >
      {line.words.map((w, i) => {
        const on = (c.animation === 'karaoke' || c.animation === 'pop') && t >= w.start && (i === line.words.length - 1 || t < line.words[i + 1].start);
        return (
          <span key={i} style={{ color: on ? c.highlight_color : undefined, display: 'inline-block', transform: on && c.animation === 'pop' ? 'scale(1.12)' : undefined, transition: 'transform 90ms' }}>
            {w.word}{i < line.words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
}
