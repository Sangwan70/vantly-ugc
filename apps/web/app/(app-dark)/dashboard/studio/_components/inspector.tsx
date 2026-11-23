// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Properties of the selected clip (speed, zoom/pan, fades) or text overlay (text, position, animation). */

import { ArrowLeft, ArrowRight, Crosshair, Scissors, Trash2 } from 'lucide-react';
import { clipOutputDuration, type TextOverlay, type VoiceoverClip } from '@vantly-ugc/schema';
import { fmtTime } from '../_lib/ops';
import { Btn, C, Field, Input, Seg, Select, Slider } from './ui';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function ClipInspector({ clip, index, count, picking, onChange, onPickFocus, onSplit, onDelete, onMove }: {
  clip: VoiceoverClip;
  index: number;
  count: number;
  picking: boolean;
  onChange: (patch: Partial<VoiceoverClip>, coalesce?: string) => void;
  onPickFocus: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const z = clip.zoom;
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold" style={{ color: C.text }}>Clip {index + 1} of {count}</p>
        <span className="text-[11px]" style={{ color: C.muted }}>{fmtTime(clipOutputDuration(clip))} on timeline</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Btn small onClick={onSplit}><Scissors className="h-3.5 w-3.5" /> Split at playhead</Btn>
        <Btn small disabled={index === 0} onClick={() => onMove(-1)}><ArrowLeft className="h-3.5 w-3.5" /></Btn>
        <Btn small disabled={index === count - 1} onClick={() => onMove(1)}><ArrowRight className="h-3.5 w-3.5" /></Btn>
        <Btn small disabled={count <= 1} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</Btn>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Source in"><Input type="number" step={0.1} min={0} value={clip.src_in.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < clip.src_out - 0.1) onChange({ src_in: v }, 'in'); }} /></Field>
        <Field label="Source out"><Input type="number" step={0.1} value={clip.src_out.toFixed(2)} onChange={(e) => { const v = Number(e.target.value); if (v > clip.src_in + 0.1) onChange({ src_out: v }, 'out'); }} /></Field>
      </div>

      <Field label="Speed" hint="speed up long scrolls / waits">
        <div className="flex flex-wrap gap-1">
          {SPEEDS.map((s) => (
            <button key={s} type="button" onClick={() => onChange({ speed: s })} className="rounded-md px-2 py-1 text-[11px]"
              style={clip.speed === s ? { background: C.accent, color: C.bg } : { border: `1px solid ${C.line2}`, color: C.text }}>
              {s}×
            </button>
          ))}
        </div>
      </Field>

      <Field label="Zoom & pan">
        <Seg
          value={z.mode}
          onChange={(mode) => onChange({ zoom: { ...z, mode, scale: mode !== 'none' && z.scale <= 1 ? 1.6 : z.scale } })}
          options={[{ value: 'none', label: 'None' }, { value: 'focus', label: 'Focus' }, { value: 'in', label: 'Push in' }, { value: 'out', label: 'Pull out' }]}
        />
      </Field>
      {z.mode !== 'none' ? (
        <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
          <Slider label="Zoom" min={1.1} max={4} step={0.05} value={z.scale} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ zoom: { ...z, scale: v } }, 'zs')} />
          {z.mode === 'focus' ? <Slider label="Ease in/out" min={0} max={2} step={0.05} value={z.ease} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => onChange({ zoom: { ...z, ease: v } }, 'ze')} /> : null}
          <div className="flex items-center gap-2">
            <Btn small primary={picking} onClick={onPickFocus}><Crosshair className="h-3.5 w-3.5" /> {picking ? 'Click on the preview…' : 'Pick focus point'}</Btn>
            <span className="font-mono text-[11px]" style={{ color: C.muted }}>{Math.round(z.x * 100)}%, {Math.round(z.y * 100)}%</span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Slider label="Fade in" min={0} max={2} step={0.1} value={clip.fade_in} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => onChange({ fade_in: v }, 'fi')} />
        <Slider label="Fade out" min={0} max={2} step={0.1} value={clip.fade_out} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => onChange({ fade_out: v }, 'fo')} />
      </div>
    </div>
  );
}

const POSITIONS: { label: string; x: number; y: number }[] = [
  { label: 'Top', x: 0.5, y: 0.1 },
  { label: 'Center', x: 0.5, y: 0.5 },
  { label: 'Lower third', x: 0.5, y: 0.78 },
];

export function OverlayInspector({ o, onChange, onDelete }: {
  o: TextOverlay;
  onChange: (patch: Partial<TextOverlay>, coalesce?: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center">
        <p className="text-xs font-semibold" style={{ color: C.text }}>Text</p>
        <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: '#FCA5A5' }} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
      </div>
      <textarea
        value={o.text}
        onChange={(e) => onChange({ text: e.target.value.slice(0, 300) || ' ' }, 'text')}
        rows={2}
        className="w-full rounded-lg px-2 py-1.5 text-sm outline-none"
        style={{ background: C.bg, color: C.text, border: `1px solid ${C.line2}` }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)"><Input type="number" step={0.1} min={0} value={o.start.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < o.end - 0.2) onChange({ start: v }, 'start'); }} /></Field>
        <Field label="End (s)"><Input type="number" step={0.1} value={o.end.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (v > o.start + 0.2) onChange({ end: v }, 'end'); }} /></Field>
      </div>
      <Field label="Animation">
        <Seg value={o.animation} onChange={(animation) => onChange({ animation })}
          options={[{ value: 'none', label: 'None' }, { value: 'fade', label: 'Fade' }, { value: 'slide_up', label: 'Slide up' }, { value: 'pop', label: 'Pop' }]} />
      </Field>
      <Field label="Position" hint="or drag it on the preview">
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <Btn key={pos.label} small onClick={() => onChange({ x: pos.x, y: pos.y })}>{pos.label}</Btn>
          ))}
        </div>
      </Field>
      <Slider label="Size" min={20} max={140} step={1} value={o.size} fmt={(v) => `${v}px`} onChange={(v) => onChange({ size: v }, 'size')} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Text colour"><input type="color" value={o.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() }, 'color')} className="h-8 w-full rounded-lg" style={{ background: C.bg, border: `1px solid ${C.line2}` }} /></Field>
        <Field label="Box">
          <div className="flex items-center gap-1.5">
            <input type="checkbox" checked={o.box} onChange={(e) => onChange({ box: e.target.checked })} />
            <input type="color" disabled={!o.box} value={o.box_color} onChange={(e) => onChange({ box_color: e.target.value.toUpperCase() }, 'boxc')} className="h-8 flex-1 rounded-lg disabled:opacity-30" style={{ background: C.bg, border: `1px solid ${C.line2}` }} />
          </div>
        </Field>
      </div>
      <Field label="Style preset">
        <Select value="" onChange={(e) => {
          const v = e.target.value;
          if (v === 'step') onChange({ box: true, box_color: '#1565C0', color: '#FFFFFF', size: 48, animation: 'slide_up', x: 0.5, y: 0.1 });
          if (v === 'title') onChange({ box: true, box_color: '#0B2E5C', color: '#FFFFFF', size: 72, animation: 'pop', x: 0.5, y: 0.45 });
          if (v === 'callout') onChange({ box: false, color: '#FCD34D', size: 56, animation: 'fade' });
        }}>
          <option value="">Apply a preset…</option>
          <option value="step">Step label (Step 1/6 · …)</option>
          <option value="title">Big title</option>
          <option value="callout">Callout (no box)</option>
        </Select>
      </Field>
    </div>
  );
}
