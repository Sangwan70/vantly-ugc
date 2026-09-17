// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * The agent page's "start creating" screen: a structured make_ugc form
 * rather than a freeform chat prompt, so submitting always sends a
 * well-formed request (never the "provide either script or scene_action"
 * class of error a vague chat message could trigger from the LLM router).
 *
 * The header reads as one sentence with two inline dropdowns:
 *   "Create a [video type] video for [platform] using exactly this script.."
 * — video type picks which make_ugc identity fields are relevant (a plain
 * talking head / a product-in-hands ad / a b-roll narrated review / a
 * silent action clip) and platform sets aspect_ratio. Everything below
 * (script, music, language, subtitles, watermark, character, voice actor)
 * reuses the SAME make_ugc form + RunPanel the Skill Center already uses
 * (see ../skills/_forms.ts, ../skills/_run-panel.tsx) so submission,
 * credit preflight, and the ETA banner are all the exact same tested path
 * — this component only adds the header and narrows which fields show.
 */

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { RunPanel, type RunResult, type SkillEntry } from '../skills/_run-panel';
import { FORMS, type Field } from '../skills/_forms';

type VideoType = 'talking_head' | 'product' | 'broll_review' | 'silent_action';
type Platform = '9:16' | '1:1';

const VIDEO_TYPE_OPTIONS: { value: VideoType; label: string }[] = [
  { value: 'talking_head', label: 'Talking-Head UGC' },
  { value: 'product', label: 'Product in Hands' },
  { value: 'broll_review', label: 'B-Roll Review' },
  { value: 'silent_action', label: 'Silent Action Clip' },
];

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: '9:16', label: 'Vertical (TikTok / Reels / Shorts)' },
  { value: '1:1', label: 'Square' },
];

// Which make_ugc form field NAMES are relevant per video type. Settings
// fields not listed here (music, language, subtitles, watermark, voice,
// look) are always shown -- the underlying routes that don't apply a given
// setting (e.g. make_product_in_hands has no watermark step yet) just
// silently ignore that one field rather than erroring, so it's simpler and
// more honest to keep the settings panel constant and only vary the
// IDENTITY fields, which really do differ by type.
const IDENTITY_FIELDS_BY_TYPE: Record<VideoType, string[]> = {
  talking_head: ['script', 'person', 'image', 'character'],
  product: ['script', 'scene_action', 'product_image', 'character'],
  broll_review: ['script', 'broll_url', 'image', 'character'],
  silent_action: ['scene_action', 'character'],
};

const ALL_IDENTITY_FIELDS = ['script', 'scene_action', 'person', 'image', 'character', 'product_image', 'broll_url'];

const REQUIRED_CHARACTER_TYPES = new Set<VideoType>(['product', 'silent_action']);

export const MAKE_UGC_ENTRY: SkillEntry = {
  slug: 'make_ugc',
  name: 'Vantly UGC Video',
  version: '1.0.0',
  description: 'The ONE tool for UGC video.',
  primitive: 'composed:make_ugc',
};

const selectStyle: React.CSSProperties = {
  backgroundColor: '#1F2030',
  color: '#E9E9F0',
  border: '1px solid rgba(167,139,250,0.35)',
  borderRadius: 8,
  padding: '3px 8px',
  fontSize: 'inherit',
  fontWeight: 600,
};

const titleSelectStyle: React.CSSProperties = { ...selectStyle, fontSize: 'inherit', fontWeight: 700, padding: '4px 10px' };

export function CreateComposer({ onGenerate }: { onGenerate: (result: RunResult) => void }) {
  const [videoType, setVideoType] = useState<VideoType>('talking_head');
  const [platform, setPlatform] = useState<Platform>('9:16');

  const form = useMemo(() => {
    const allowedIdentity = new Set(IDENTITY_FIELDS_BY_TYPE[videoType]);
    const fields: Field[] = FORMS.make_ugc.fields.filter((f) => {
      if (f.name === 'aspect_ratio') return false; // driven by the platform dropdown instead
      if (ALL_IDENTITY_FIELDS.includes(f.name)) return allowedIdentity.has(f.name);
      return true;
    });
    return { fields, composed: FORMS.make_ugc.composed };
  }, [videoType]);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5 text-[26px] font-bold" style={{ color: '#E9E9F0', letterSpacing: '-0.01em' }}>
        <Sparkles className="h-6 w-6 shrink-0" style={{ color: '#A78BFA' }} />
        <span>Create a</span>
        <select value={videoType} onChange={(e) => setVideoType(e.target.value as VideoType)} style={titleSelectStyle}>
          {VIDEO_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[34px] text-[15px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
        <span>for</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} style={selectStyle}>
          {PLATFORM_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span>using exactly this script..</span>
      </div>

      {REQUIRED_CHARACTER_TYPES.has(videoType) && (
        <p className="text-[12.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          This type needs a saved character below — it&apos;s who holds the product or performs the action.
        </p>
      )}

      <RunPanel
        key={`${videoType}-${platform}`}
        skill={MAKE_UGC_ENTRY}
        form={form}
        activeRun={null}
        onLaunched={onGenerate}
        initialValues={{ aspect_ratio: platform }}
        submitLabel="Generate Video"
        hideHeading
      />
    </div>
  );
}
