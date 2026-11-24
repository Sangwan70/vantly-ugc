// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Properties of the selected item:
 *   clip     speed, camera (simple zoom or keyframes), transition, fades
 *   card     title card text, colours, length, animation
 *   overlay  text / lower third / callout, animation, position, font, colours
 *   effect   click, spotlight, highlight, arrow, redaction
 */

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Crosshair, Diamond, Plus, Scissors, Trash2 } from 'lucide-react';
import {
  TRANSITION_KINDS,
  cameraAt,
  clipCameraAt,
  clipOutputDuration,
  type CameraKeyframe,
  type FontAsset,
  type TextOverlay,
  type VoiceoverCard,
  type VoiceoverClip,
  type VoiceoverEffect,
} from '@vantly-ugc/schema';
import { fmtTime } from '../_lib/ops';
import { Btn, C, Field, Input, Seg, Select, Slider } from './ui';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const EASES: CameraKeyframe['ease'][] = ['ease_in_out', 'linear', 'ease_in', 'ease_out', 'hold'];
const TRANSITION_LABEL: Record<string, string> = { none: 'Cut', crossfade: 'Crossfade', fade_black: 'Dip to black', slide_left: 'Slide', slide_up: 'Slide up', zoom: 'Zoom', wipe: 'Wipe' };
export const BUILTIN_FONTS = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'DejaVu Sans'];

type Pick = (space: 'content' | 'frame', label: string, onPick: (x: number, y: number) => void) => void;

export function ClipInspector({ clip, index, count, localTime, picking, onChange, onPick, onSplit, onDelete, onMove }: {
  clip: VoiceoverClip;
  index: number;
  count: number;
  /** Playhead relative to the clip start (clamped to the clip). */
  localTime: number;
  picking: boolean;
  onChange: (patch: Partial<VoiceoverClip>, coalesce?: string) => void;
  onPick: Pick;
  onSplit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [kfSel, setKfSel] = useState<number | null>(null);
  const d = clipOutputDuration(clip);
  const isCard = clip.kind === 'card';
  const kfs = [...clip.keyframes].sort((a, b) => a.t - b.t);
  const camMode = kfs.length ? 'keyframes' : clip.zoom.mode;

  const setKf = (i: number, patch: Partial<CameraKeyframe>, co?: string) => {
    const next = kfs.map((k, j) => (j === i ? { ...k, ...patch } : k)).sort((a, b) => a.t - b.t);
    onChange({ keyframes: next }, co);
  };
  const addKf = () => {
    const t = Math.max(0, Math.min(d, localTime));
    const cam = kfs.length ? cameraAt(kfs, t) : clipCameraAt(clip, t);
    const next = [...kfs.filter((k) => Math.abs(k.t - t) > 0.05), { t, zoom: Math.max(1.5, cam.zoom), x: cam.x, y: cam.y, ease: 'ease_in_out' as const }].sort((a, b) => a.t - b.t);
    const seeded = kfs.length ? next : [{ t: 0, zoom: 1, x: 0.5, y: 0.5, ease: 'ease_in_out' as const }, ...next.filter((k) => k.t > 0.05)];
    onChange({ keyframes: seeded, zoom: { ...clip.zoom, mode: 'none' } });
    setKfSel(seeded.findIndex((k) => Math.abs(k.t - t) < 0.06));
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold" style={{ color: C.text }}>{isCard ? 'Title card' : 'Clip'} {index + 1} of {count}</p>
        <span className="text-[11px]" style={{ color: C.muted }}>{fmtTime(d)} on timeline</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!isCard ? <Btn small onClick={onSplit}><Scissors className="h-3.5 w-3.5" /> Split</Btn> : null}
        <Btn small disabled={index === 0} onClick={() => onMove(-1)}><ArrowLeft className="h-3.5 w-3.5" /></Btn>
        <Btn small disabled={index === count - 1} onClick={() => onMove(1)}><ArrowRight className="h-3.5 w-3.5" /></Btn>
        <Btn small disabled={count <= 1} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</Btn>
      </div>

      {isCard && clip.card ? <CardEditor card={clip.card} onChange={(card, co) => onChange({ card: { ...clip.card!, ...card } }, co)} /> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Source in"><Input type="number" step={0.1} min={0} value={clip.src_in.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < clip.src_out - 0.1) onChange({ src_in: v }, 'in'); }} /></Field>
            <Field label="Source out"><Input type="number" step={0.1} value={clip.src_out.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v > clip.src_in + 0.1) onChange({ src_out: v }, 'out'); }} /></Field>
          </div>
          <Field label="Speed" hint="speed up long scrolls / waits">
            <div className="flex flex-wrap gap-1">
              {SPEEDS.map((s) => (
                <button key={s} type="button" onClick={() => onChange({ speed: s })} className="rounded-md px-2 py-1 text-[11px]"
                  style={clip.speed === s ? { background: C.accent, color: C.bg } : { border: `1px solid ${C.line2}`, color: C.text }}>{s}×</button>
              ))}
            </div>
          </Field>

          <Field label="Camera">
            <Seg value={camMode}
              onChange={(mode) => {
                if (mode === 'keyframes') { if (!kfs.length) addKf(); return; }
                onChange({ keyframes: [], zoom: { ...clip.zoom, mode, scale: mode !== 'none' && clip.zoom.scale <= 1 ? 1.6 : clip.zoom.scale } });
              }}
              options={[{ value: 'none', label: 'Still' }, { value: 'focus', label: 'Focus' }, { value: 'in', label: 'Push' }, { value: 'out', label: 'Pull' }, { value: 'keyframes', label: 'Keyframes' }]} />
          </Field>

          {camMode !== 'none' && camMode !== 'keyframes' ? (
            <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
              <Slider label="Zoom" min={1.1} max={4} step={0.05} value={clip.zoom.scale} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ zoom: { ...clip.zoom, scale: v } }, 'zs')} />
              {camMode === 'focus' ? <Slider label="Ease in/out" min={0} max={2} step={0.05} value={clip.zoom.ease} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => onChange({ zoom: { ...clip.zoom, ease: v } }, 'ze')} /> : null}
              <div className="flex items-center gap-2">
                <Btn small primary={picking} onClick={() => onPick('content', 'Click where the camera should focus', (x, y) => onChange({ zoom: { ...clip.zoom, x, y } }))}><Crosshair className="h-3.5 w-3.5" /> Pick focus</Btn>
                <span className="font-mono text-[11px]" style={{ color: C.muted }}>{Math.round(clip.zoom.x * 100)}%, {Math.round(clip.zoom.y * 100)}%</span>
              </div>
            </div>
          ) : null}

          {camMode === 'keyframes' ? (
            <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
              <div className="flex items-center gap-2">
                <Btn small onClick={addKf}><Plus className="h-3.5 w-3.5" /> Keyframe at {fmtTime(Math.max(0, Math.min(d, localTime)))}</Btn>
                <span className="text-[10px]" style={{ color: C.faint }}>times are within this clip</span>
              </div>
              {kfs.map((k, i) => (
                <div key={i} className="rounded-md p-1.5" style={{ border: `1px solid ${kfSel === i ? 'rgba(167,139,250,0.6)' : C.line}` }} onClick={() => setKfSel(i)}>
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: C.text }}>
                    <Diamond className="h-3 w-3" style={{ color: '#7DD3FC' }} />
                    <input type="number" step={0.1} min={0} max={d} value={k.t.toFixed(2)} onChange={(e) => setKf(i, { t: Math.max(0, Math.min(d, Number(e.target.value))) }, `kt${i}`)}
                      className="w-14 rounded px-1 font-mono outline-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.line2}` }} />
                    <span>{k.zoom.toFixed(2)}× @ {Math.round(k.x * 100)},{Math.round(k.y * 100)}</span>
                    <button type="button" className="ml-auto" style={{ color: '#FCA5A5' }} onClick={(e) => { e.stopPropagation(); onChange({ keyframes: kfs.filter((_, j) => j !== i) }); }}><Trash2 className="h-3 w-3" /></button>
                  </div>
                  {kfSel === i ? (
                    <div className="mt-1.5 space-y-1.5">
                      <Slider label="Zoom" min={1} max={4} step={0.05} value={k.zoom} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => setKf(i, { zoom: v }, `kz${i}`)} />
                      <div className="flex items-center gap-1.5">
                        <Btn small onClick={() => onPick('content', 'Click the point this keyframe frames', (x, y) => setKf(i, { x, y }))}><Crosshair className="h-3.5 w-3.5" /> Point</Btn>
                        <Select value={k.ease} onChange={(e) => setKf(i, { ease: e.target.value as CameraKeyframe['ease'] })}>
                          {EASES.map((e) => <option key={e} value={e}>{e.replace(/_/g, ' ')} → next</option>)}
                        </Select>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Slider label="Fade in" min={0} max={2} step={0.1} value={clip.fade_in} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => onChange({ fade_in: v }, 'fi')} />
            <Slider label="Fade out" min={0} max={2} step={0.1} value={clip.fade_out} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => onChange({ fade_out: v }, 'fo')} />
          </div>
        </>
      )}

      {index > 0 ? (
        <Field label="Transition in">
          <div className="flex items-center gap-2">
            <Select value={clip.transition.kind} onChange={(e) => onChange({ transition: { ...clip.transition, kind: e.target.value as VoiceoverClip['transition']['kind'] } })}>
              {TRANSITION_KINDS.map((t) => <option key={t} value={t}>{TRANSITION_LABEL[t]}</option>)}
            </Select>
            {clip.transition.kind !== 'none' ? (
              <div className="w-32"><Slider label="" min={0.1} max={2} step={0.05} value={clip.transition.duration} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => onChange({ transition: { ...clip.transition, duration: v } }, 'tr')} /></div>
            ) : null}
          </div>
        </Field>
      ) : null}
    </div>
  );
}

function CardEditor({ card, onChange }: { card: VoiceoverCard; onChange: (p: Partial<VoiceoverCard>, co?: string) => void }) {
  return (
    <div className="space-y-2">
      <Field label="Title"><Input value={card.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value }, 'ct')} /></Field>
      <Field label="Subtitle"><Input value={card.subtitle} maxLength={200} onChange={(e) => onChange({ subtitle: e.target.value }, 'cs')} /></Field>
      <Slider label="Length" min={0.5} max={15} step={0.5} value={card.duration} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => onChange({ duration: v }, 'cd')} />
      <div className="grid grid-cols-3 gap-2">
        <Field label="Background"><input type="color" value={card.bg} onChange={(e) => onChange({ bg: e.target.value.toUpperCase() }, 'cb')} className="h-8 w-full rounded-lg" /></Field>
        <Field label="Text"><input type="color" value={card.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() }, 'cc')} className="h-8 w-full rounded-lg" /></Field>
        <Field label="Accent"><input type="color" value={card.accent} onChange={(e) => onChange({ accent: e.target.value.toUpperCase() }, 'ca')} className="h-8 w-full rounded-lg" /></Field>
      </div>
      <Field label="Animation"><Seg value={card.animation} onChange={(animation) => onChange({ animation })} options={[{ value: 'slide_up', label: 'Slide up' }, { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' }]} /></Field>
      <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={card.logo} onChange={(e) => onChange({ logo: e.target.checked })} /> Show brand logo</label>
    </div>
  );
}

const POSITIONS = [{ label: 'Top', x: 0.5, y: 0.1 }, { label: 'Center', x: 0.5, y: 0.5 }, { label: 'Lower third', x: 0.5, y: 0.78 }];

export function OverlayInspector({ o, fonts, onChange, onPick, onDelete }: {
  o: TextOverlay;
  fonts: FontAsset[];
  onChange: (patch: Partial<TextOverlay>, coalesce?: string) => void;
  onPick: Pick;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center">
        <p className="text-xs font-semibold" style={{ color: C.text }}>Text</p>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: '#FCA5A5' }} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
      </div>
      <Seg value={o.kind} onChange={(kind) => onChange(kind === 'lower_third' ? { kind, x: 0.05, y: 0.82, box: true } : kind === 'callout' ? { kind, box: true, animation: 'pop' } : { kind })}
        options={[{ value: 'text', label: 'Label' }, { value: 'lower_third', label: 'Lower third' }, { value: 'callout', label: 'Callout' }]} />
      <textarea value={o.text} onChange={(e) => onChange({ text: e.target.value.slice(0, 300) || ' ' }, 'text')} rows={2}
        className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }} />
      {o.kind === 'lower_third' ? <Field label="Subtitle"><Input value={o.subtitle} maxLength={200} onChange={(e) => onChange({ subtitle: e.target.value }, 'sub')} /></Field> : null}
      {o.kind === 'callout' ? (
        <div className="flex items-center gap-2">
          <Btn small onClick={() => onPick('frame', 'Click what the arrow should point at', (tx, ty) => onChange({ tx, ty }))}><Crosshair className="h-3.5 w-3.5" /> Arrow target</Btn>
          <span className="font-mono text-[11px]" style={{ color: C.muted }}>{Math.round(o.tx * 100)}%, {Math.round(o.ty * 100)}%</span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)"><Input type="number" step={0.1} min={0} value={o.start.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < o.end - 0.2) onChange({ start: v }, 'start'); }} /></Field>
        <Field label="End (s)"><Input type="number" step={0.1} value={o.end.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v > o.start + 0.2) onChange({ end: v }, 'end'); }} /></Field>
      </div>
      {o.kind !== 'lower_third' ? (
        <Field label="Animation">
          <Select value={o.animation} onChange={(e) => onChange({ animation: e.target.value as TextOverlay['animation'] })}>
            {['none', 'fade', 'slide_up', 'slide_left', 'pop', 'typewriter'].map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
          </Select>
        </Field>
      ) : null}
      {o.kind === 'text' ? (
        <Field label="Position" hint="or drag it on the preview">
          <div className="flex gap-1">{POSITIONS.map((pos) => <Btn key={pos.label} small onClick={() => onChange({ x: pos.x, y: pos.y })}>{pos.label}</Btn>)}</div>
        </Field>
      ) : null}
      <Field label="Font">
        <Select value={o.font} onChange={(e) => onChange({ font: e.target.value })}>
          <optgroup label="Built-in">{BUILTIN_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
          {fonts.length ? <optgroup label="Brand fonts">{fonts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup> : null}
        </Select>
      </Field>
      <Slider label="Size" min={20} max={140} step={1} value={o.size} fmt={(v) => `${v}px`} onChange={(v) => onChange({ size: v }, 'size')} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Text colour"><input type="color" value={o.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() }, 'color')} className="h-8 w-full rounded-lg" style={{ background: C.bg, border: `1px solid ${C.line2}` }} /></Field>
        <Field label={o.kind === 'lower_third' ? 'Bar' : 'Box'}>
          <div className="flex items-center gap-1.5">
            {o.kind !== 'lower_third' ? <input type="checkbox" checked={o.box} onChange={(e) => onChange({ box: e.target.checked })} /> : null}
            <input type="color" disabled={!o.box && o.kind !== 'lower_third'} value={o.box_color} onChange={(e) => onChange({ box_color: e.target.value.toUpperCase() }, 'boxc')} className="h-8 flex-1 rounded-lg disabled:opacity-30" style={{ background: C.bg, border: `1px solid ${C.line2}` }} />
          </div>
        </Field>
      </div>
    </div>
  );
}

const FX_HELP: Record<VoiceoverEffect['kind'], string> = {
  click: 'Ripple ring where a click happens.',
  spotlight: 'Dims everything except the box.',
  highlight: 'Outlined box around a UI element.',
  arrow: 'Arrow pointing at something.',
  blur: 'Pixelates the box — redact emails, keys, names.',
};

export function EffectInspector({ fx, onChange, onPick, onDelete }: {
  fx: VoiceoverEffect;
  onChange: (patch: Partial<VoiceoverEffect>, coalesce?: string) => void;
  onPick: Pick;
  onDelete: () => void;
}) {
  const boxed = fx.kind === 'spotlight' || fx.kind === 'highlight' || fx.kind === 'blur';
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center">
        <p className="text-xs font-semibold capitalize" style={{ color: C.text }}>{fx.kind === 'blur' ? 'Redact' : fx.kind}</p>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: '#FCA5A5' }} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
      </div>
      <p className="text-[11px]" style={{ color: C.muted }}>{FX_HELP[fx.kind]} Drag it on the preview to move it.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)"><Input type="number" step={0.1} min={0} value={fx.start.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < fx.end - 0.1) onChange({ start: v }, 'fs'); }} /></Field>
        <Field label="End (s)"><Input type="number" step={0.1} value={fx.end.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v > fx.start + 0.1) onChange({ end: v }, 'fe'); }} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Btn small onClick={() => onPick('frame', fx.kind === 'arrow' ? 'Click what the arrow points at' : 'Click the centre', (x, y) => onChange({ x, y }))}><Crosshair className="h-3.5 w-3.5" /> {fx.kind === 'arrow' ? 'Arrow tip' : 'Centre'}</Btn>
        {fx.kind === 'arrow' ? <Btn small onClick={() => onPick('frame', 'Click where the arrow starts', (from_x, from_y) => onChange({ from_x, from_y }))}><Crosshair className="h-3.5 w-3.5" /> Arrow tail</Btn> : null}
      </div>
      {boxed ? (
        <>
          <Slider label="Width" min={0.02} max={1} step={0.01} value={fx.w} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ w: v }, 'fw')} />
          <Slider label="Height" min={0.02} max={1} step={0.01} value={fx.h} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ h: v }, 'fh')} />
        </>
      ) : null}
      <Slider label={fx.kind === 'spotlight' ? 'Dim' : fx.kind === 'blur' ? 'Strength' : fx.kind === 'click' ? 'Ripple size' : 'Fill'} min={0} max={1} step={0.05} value={fx.intensity} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ intensity: v }, 'fi')} />
      {fx.kind !== 'spotlight' && fx.kind !== 'blur' ? <Field label="Colour"><input type="color" value={fx.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() }, 'fc')} className="h-8 w-full rounded-lg" /></Field> : null}
    </div>
  );
}
