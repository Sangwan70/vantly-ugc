// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Brand (logo, palette, badge), fonts, captions, audio (music, loudness), intro/outro cards and templates. */

import { useEffect, useState } from 'react';
import { Download, Loader2, Music, Plus, Trash2, Upload } from 'lucide-react';
import { CardSchema, type VoiceoverTimeline } from '@vantly-ugc/schema';
import { studioApi, uploadDirect, type Template } from '../_lib/api';
import { uid } from '../_lib/ops';
import { BUILTIN_FONTS } from './inspector';
import { Btn, C, Field, Input, Seg, Select, Slider } from './ui';

type Update = (fn: (t: VoiceoverTimeline) => VoiceoverTimeline, opts?: { coalesce?: string }) => void;

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-2 p-3" style={{ borderBottom: `1px solid ${C.line}` }}>
      <div className="flex items-center"><p className="text-xs font-semibold" style={{ color: C.text }}>{title}</p><div className="ml-auto">{right}</div></div>
      {children}
    </div>
  );
}

function FilePick({ accept, label, busy, onFile }: { accept: string; label: string; busy: boolean; onFile: (f: File) => void }) {
  return (
    <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[11px]" style={{ border: `1px solid ${C.line2}`, color: C.text, opacity: busy ? 0.5 : 1 }}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {label}
      <input type="file" accept={accept} className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </label>
  );
}

export function StylePanel({ projectId, workspaceId, timeline, update, onTimelineReplaced }: {
  projectId: string;
  workspaceId: string | null;
  timeline: VoiceoverTimeline;
  update: Update;
  onTimelineReplaced: (t: VoiceoverTimeline) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplName, setTplName] = useState('');
  const b = timeline.branding;
  const cap = timeline.output.captions;
  const music = timeline.audio.music;

  useEffect(() => { studioApi.templates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([])); }, []);

  const asset = async (kind: 'music' | 'logo' | 'font', file: File) => {
    setBusy(kind); setErr(null);
    try {
      const raw = await uploadDirect(file, { workspaceId });
      const { url } = await studioApi.asset({ kind, url: raw, project_id: projectId, name: file.name });
      return url;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(null); }
  };

  const importBrandKit = async () => {
    setBusy('brand'); setErr(null);
    try {
      const r = await fetch('/api/onboarding/state');
      const j = (await r.json()) as { onboarding_data?: { brand?: { logo?: string | null; palette?: string[]; brand_name?: string | null } } };
      const brand = j.onboarding_data?.brand;
      if (!brand) throw new Error('No Brand Kit yet — set one up under Gallery → Brand Kit.');
      let logo: string | null = null;
      if (brand.logo && !/\.(ico|svg)(\?|$)/i.test(brand.logo)) logo = (await studioApi.asset({ kind: 'logo', url: brand.logo, project_id: projectId }).catch(() => null))?.url ?? null;
      const palette = (brand.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8).map((c) => c.toUpperCase());
      update((t) => ({ ...t, branding: { ...t.branding, ...(logo ? { logo_url: logo } : {}), palette } }));
      if (!logo && brand.logo) setErr('Imported the palette. The logo is SVG/ICO — upload a PNG version to use it.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const addCard = (where: 'intro' | 'outro') => {
    const card = CardSchema.parse({ title: where === 'intro' ? 'Your title' : 'Thanks for watching', subtitle: where === 'intro' ? '' : 'Subscribe for the next episode', bg: b.palette[0] ?? '#0B2E5C', accent: b.palette[1] ?? '#1565C0' });
    const clip = { id: uid('card'), kind: 'card' as const, card, src_in: 0, src_out: 1, speed: 1, zoom: { mode: 'none' as const, scale: 1.6, x: 0.5, y: 0.5, ease: 0.6 }, keyframes: [], fade_in: 0, fade_out: 0, transition: { kind: 'crossfade' as const, duration: 0.5 } };
    update((t) => {
      if (where === 'outro') return { ...t, clips: [...t.clips, clip] };
      // Everything after the intro moves right by its length.
      const shift = card.duration - 0.5;
      return {
        ...t,
        clips: [{ ...clip, transition: { kind: 'none', duration: 0.5 } }, { ...t.clips[0], transition: { kind: 'crossfade', duration: 0.5 } }, ...t.clips.slice(1)],
        blocks: t.blocks.map((x) => ({ ...x, start: x.start + shift })),
        overlays: t.overlays.map((o) => ({ ...o, start: o.start + shift, end: o.end + shift })),
        effects: t.effects.map((e) => ({ ...e, start: e.start + shift, end: e.end + shift })),
      };
    });
  };
  const hasIntro = timeline.clips[0]?.kind === 'card';
  const hasOutro = timeline.clips.length > 1 && timeline.clips[timeline.clips.length - 1]?.kind === 'card';

  return (
    <div>
      {err ? <div className="m-3 rounded-lg p-2 text-[11px]" style={{ background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{err}</div> : null}

      <Section title="Templates">
        <div className="flex gap-1.5">
          <Select value="" onChange={async (e) => {
            if (!e.target.value) return;
            setBusy('tpl');
            try { const r = await studioApi.applyTemplate(projectId, e.target.value); onTimelineReplaced(r.timeline); } catch (er) { setErr((er as Error).message); } finally { setBusy(null); }
          }}>
            <option value="">{templates === null ? 'Loading…' : templates.length ? 'Apply a template…' : 'No templates yet'}</option>
            {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.workspace_id ? ' · team' : ''}{t.has_intro ? ' · intro' : ''}</option>)}
          </Select>
        </div>
        <div className="flex gap-1.5">
          <Input placeholder="Save this look as… (e.g. TheSkillPedia tutorial)" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <Btn small disabled={!tplName.trim() || busy === 'save'} onClick={async () => {
            setBusy('save');
            try { await studioApi.saveTemplate({ name: tplName.trim(), project_id: projectId, workspace_id: workspaceId }); setTplName(''); setTemplates((await studioApi.templates()).templates); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
          }}>Save</Btn>
        </div>
        <p className="text-[10px]" style={{ color: C.faint }}>Saves frame, captions, music, branding, fonts, pronunciations, intro/outro and default voice{workspaceId ? ' — shared with your workspace' : ''}.</p>
      </Section>

      <Section title="Brand" right={<Btn small disabled={busy === 'brand'} onClick={importBrandKit}>{busy === 'brand' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} From Brand Kit</Btn>}>
        <div className="flex items-center gap-2">
          {b.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logo_url} alt="logo" className="h-8 max-w-[90px] rounded object-contain" style={{ background: '#fff' }} />
          ) : <span className="text-[11px]" style={{ color: C.faint }}>No logo</span>}
          <FilePick accept="image/png,image/jpeg" label="Logo" busy={busy === 'logo'} onFile={async (f) => { const url = await asset('logo', f); if (url) update((t) => ({ ...t, branding: { ...t.branding, logo_url: url } })); }} />
          {b.logo_url ? <button type="button" style={{ color: '#FCA5A5' }} onClick={() => update((t) => ({ ...t, branding: { ...t.branding, logo_url: null } }))}><Trash2 className="h-3.5 w-3.5" /></button> : null}
        </div>
        {b.logo_url ? (
          <>
            <Seg value={b.logo_position} onChange={(logo_position) => update((t) => ({ ...t, branding: { ...t.branding, logo_position } }))} options={[{ value: 'tl', label: '↖' }, { value: 'tr', label: '↗' }, { value: 'bl', label: '↙' }, { value: 'br', label: '↘' }]} />
            <Slider label="Size" min={0.03} max={0.3} step={0.005} value={b.logo_size} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((t) => ({ ...t, branding: { ...t.branding, logo_size: v } }), { coalesce: 'lsize' })} />
            <Slider label="Opacity" min={0.1} max={1} step={0.05} value={b.logo_opacity} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((t) => ({ ...t, branding: { ...t.branding, logo_opacity: v } }), { coalesce: 'lop' })} />
          </>
        ) : null}
        {b.palette.length ? <div className="flex gap-1">{b.palette.map((c) => <span key={c} title={c} className="h-5 w-5 rounded" style={{ background: c, border: `1px solid ${C.line2}` }} />)}</div> : null}
        <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
          <input type="checkbox" checked={b.disclosure_badge} onChange={(e) => update((t) => ({ ...t, branding: { ...t.branding, disclosure_badge: e.target.checked } }))} /> Show “AI-generated voice” badge
        </label>
      </Section>

      <Section title="Intro & outro">
        <div className="flex gap-1.5">
          <Btn small disabled={hasIntro} onClick={() => addCard('intro')}><Plus className="h-3.5 w-3.5" /> Intro card</Btn>
          <Btn small disabled={hasOutro} onClick={() => addCard('outro')}><Plus className="h-3.5 w-3.5" /> Outro card</Btn>
        </div>
        <p className="text-[10px]" style={{ color: C.faint }}>Select a card on the Video track to edit its text, colours and animation.</p>
      </Section>

      <Section title="Fonts" right={<FilePick accept=".ttf,.otf,font/ttf,font/otf" label="Upload font" busy={busy === 'font'} onFile={async (f) => {
        const url = await asset('font', f);
        if (url) update((t) => ({ ...t, fonts: [...t.fonts, { id: uid('font'), url, name: f.name.replace(/\.(ttf|otf)$/i, '') }] }));
      }} />}>
        {timeline.fonts.length ? timeline.fonts.map((f) => (
          <div key={f.id} className="flex items-center text-[11px]" style={{ color: C.text }}>
            <span style={{ fontFamily: `"${f.id}"` }}>{f.name}</span>
            <button type="button" className="ml-auto" style={{ color: '#FCA5A5' }} onClick={() => update((t) => ({ ...t, fonts: t.fonts.filter((x) => x.id !== f.id) }))}><Trash2 className="h-3 w-3" /></button>
          </div>
        )) : <p className="text-[11px]" style={{ color: C.faint }}>Built-in: {BUILTIN_FONTS.join(', ')}.</p>}
      </Section>

      <Section title="Captions" right={<label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={cap.enabled} onChange={(e) => update((t) => ({ ...t, output: { ...t.output, captions: { ...t.output.captions, enabled: e.target.checked } } }))} /> On</label>}>
        <Seg value={cap.custom ? 'custom' : cap.style}
          onChange={(v) => update((t) => ({ ...t, output: { ...t.output, captions: v === 'custom' ? { ...t.output.captions, custom: true } : { ...t.output.captions, custom: false, style: v } } }))}
          options={[{ value: 'minimal', label: 'Minimal' }, { value: 'tiktok', label: 'Boxed' }, { value: 'hormozi', label: 'Karaoke' }, { value: 'custom', label: 'Custom' }]} />
        {cap.custom ? (
          <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
            {(() => {
              const set = (patch: Partial<typeof cap>, co?: string) => update((t) => ({ ...t, output: { ...t.output, captions: { ...t.output.captions, ...patch } } }), co ? { coalesce: co } : undefined);
              return (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Font"><Select value={cap.font} onChange={(e) => set({ font: e.target.value })}>{[...BUILTIN_FONTS.map((f) => ({ v: f, l: f })), ...timeline.fonts.map((f) => ({ v: f.id, l: f.name }))].map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}</Select></Field>
                    <Field label="Animation"><Select value={cap.animation} onChange={(e) => set({ animation: e.target.value as typeof cap.animation })}>{['none', 'fade', 'karaoke', 'pop'].map((a) => <option key={a} value={a}>{a}</option>)}</Select></Field>
                  </div>
                  <Slider label="Size" min={16} max={160} step={1} value={cap.size} fmt={(v) => `${v}px`} onChange={(v) => set({ size: v }, 'csize')} />
                  <Slider label="Words per line" min={1} max={12} step={1} value={cap.words_per_line} fmt={(v) => String(v)} onChange={(v) => set({ words_per_line: v }, 'cwpl')} />
                  <Seg value={cap.position} onChange={(position) => set({ position })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
                  <Slider label="Edge margin" min={0} max={0.45} step={0.01} value={cap.margin} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ margin: v }, 'cmar')} />
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Text"><input type="color" value={cap.color} onChange={(e) => set({ color: e.target.value.toUpperCase() }, 'ccol')} className="h-8 w-full rounded-lg" /></Field>
                    <Field label="Highlight"><input type="color" value={cap.highlight_color} onChange={(e) => set({ highlight_color: e.target.value.toUpperCase() }, 'chl')} className="h-8 w-full rounded-lg" /></Field>
                    <Field label="Box"><input type="color" value={cap.box_color} onChange={(e) => set({ box_color: e.target.value.toUpperCase() }, 'cbox')} className="h-8 w-full rounded-lg" /></Field>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: C.muted }}>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={cap.box} onChange={(e) => set({ box: e.target.checked })} /> Box</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={cap.bold} onChange={(e) => set({ bold: e.target.checked })} /> Bold</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={cap.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> UPPERCASE</label>
                  </div>
                  {cap.box ? <Slider label="Box opacity" min={0.1} max={1} step={0.05} value={cap.box_opacity} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ box_opacity: v }, 'cbo')} /> : null}
                </>
              );
            })()}
          </div>
        ) : null}
      </Section>

      <Section title="Music & sound" right={<FilePick accept="audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a" label={music ? 'Replace' : 'Add music'} busy={busy === 'music'} onFile={async (f) => {
        const url = await asset('music', f);
        if (url) update((t) => ({ ...t, audio: { ...t.audio, music: { url, name: f.name, volume: 0.25, duck: true, duck_amount: 0.7, fade_in: 1.5, fade_out: 2.5, loop: true } } }));
      }} />}>
        {music ? (
          <div className="space-y-2 rounded-lg p-2" style={{ background: C.bg }}>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: C.text }}>
              <Music className="h-3.5 w-3.5" style={{ color: C.accent }} /> <span className="truncate">{music.name}</span>
              <button type="button" className="ml-auto" style={{ color: '#FCA5A5' }} onClick={() => update((t) => ({ ...t, audio: { ...t.audio, music: null } }))}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Slider label="Music volume" min={0} max={1} step={0.01} value={music.volume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, volume: v } } }), { coalesce: 'mvol' })} />
            <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={music.duck} onChange={(e) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, duck: e.target.checked } } }))} /> Duck under the voice</label>
            {music.duck ? <Slider label="Ducking" min={0.1} max={1} step={0.05} value={music.duck_amount} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, duck_amount: v } } }), { coalesce: 'mduck' })} /> : null}
            <div className="grid grid-cols-2 gap-2">
              <Slider label="Fade in" min={0} max={10} step={0.5} value={music.fade_in} fmt={(v) => `${v}s`} onChange={(v) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, fade_in: v } } }), { coalesce: 'mfi' })} />
              <Slider label="Fade out" min={0} max={10} step={0.5} value={music.fade_out} fmt={(v) => `${v}s`} onChange={(v) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, fade_out: v } } }), { coalesce: 'mfo' })} />
            </div>
            <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}><input type="checkbox" checked={music.loop} onChange={(e) => update((t) => ({ ...t, audio: { ...t.audio, music: { ...t.audio.music!, loop: e.target.checked } } }))} /> Loop</label>
          </div>
        ) : null}
        <Field label="Loudness (final mix)">
          <Seg value={timeline.audio.loudness} onChange={(loudness) => update((t) => ({ ...t, audio: { ...t.audio, loudness } }))}
            options={[{ value: 'youtube', label: '−14 LUFS' }, { value: 'podcast', label: '−16' }, { value: 'broadcast', label: '−23' }, { value: 'off', label: 'Off' }]} />
        </Field>
        <label className="flex items-center gap-2 text-[11px]" style={{ color: C.muted }}>
          <input type="checkbox" checked={timeline.audio.voice_fades} onChange={(e) => update((t) => ({ ...t, audio: { ...t.audio, voice_fades: e.target.checked } }))} /> Click-free fades on voice blocks
        </label>
      </Section>
    </div>
  );
}
