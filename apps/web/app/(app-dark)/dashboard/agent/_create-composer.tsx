// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * The agent page's "start creating" screen: a structured make_ugc form
 * rather than a freeform chat prompt, so submitting always sends a
 * well-formed request (never the "provide either script or scene_action"
 * class of error a vague chat message could trigger from the LLM router).
 *
 * One line at the top reads as a sentence with two inline dropdowns:
 *   "Create a [video type] for [platform] using exactly this script.."
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
// IDENTITY fields, which really do differ by type. `image` and `character`
// aren't listed here any more -- they're reached via the script box's "+"
// menu and the "Use Saved Characters" settings pill respectively, both of
// which are always available regardless of video type.
const IDENTITY_FIELDS_BY_TYPE: Record<VideoType, string[]> = {
  talking_head: ['script', 'person'],
  product: ['script', 'scene_action', 'product_image'],
  broll_review: ['script', 'broll_url'],
  silent_action: ['scene_action'],
};

const ALL_IDENTITY_FIELDS = ['script', 'scene_action', 'person', 'product_image', 'broll_url'];

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

export function CreateComposer({
  onGenerate, onUseSavedPrompt, onBrowseExamples, onRunDifferentSkill, prefillValues, onPrefillApplied,
}: {
  onGenerate: (result: RunResult) => void;
  /** Wired straight into the script box's own "+" menu — see ScriptAiField
   *  in ../skills/_run-panel.tsx. Omit any of the three to hide that menu item. */
  onUseSavedPrompt?: () => void;
  onBrowseExamples?: () => void;
  onRunDifferentSkill?: () => void;
  /** Passed straight through to RunPanel — see its own doc comment. */
  prefillValues?: Record<string, string> | null;
  onPrefillApplied?: () => void;
}) {
  const [videoType, setVideoType] = useState<VideoType>('talking_head');
  const [platform, setPlatform] = useState<Platform>('9:16');

  const form = useMemo(() => {
    const allowedIdentity = new Set(IDENTITY_FIELDS_BY_TYPE[videoType]);
    const fields: Field[] = FORMS.make_ugc.fields.filter((f) => {
      if (f.name === 'aspect_ratio') return false; // driven by the platform dropdown instead
      if (ALL_IDENTITY_FIELDS.includes(f.name)) return allowedIdentity.has(f.name);
      return true;
    });
    return { fields, composed: FORMS.make_ugc.composed, exclusiveGroups: FORMS.make_ugc.exclusiveGroups, validate: FORMS.make_ugc.validate };
  }, [videoType]);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[19px] font-semibold" style={{ color: '#E9E9F0', letterSpacing: '-0.01em' }}>
        <span>Create a</span>
        <select value={videoType} onChange={(e) => setVideoType(e.target.value as VideoType)} style={selectStyle}>
          {VIDEO_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span>for</span>
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} style={selectStyle}>
          {PLATFORM_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span>using exactly this script..</span>
      </div>

      <RunPanel
        key={`${videoType}-${platform}`}
        skill={MAKE_UGC_ENTRY}
        form={form}
        activeRun={null}
        onLaunched={onGenerate}
        initialValues={{ aspect_ratio: platform }}
        submitLabel="Generate Video"
        hideHeading
        onUseSavedPrompt={onUseSavedPrompt}
        onBrowseExamples={onBrowseExamples}
        onRunDifferentSkill={onRunDifferentSkill}
        prefillValues={prefillValues}
        onPrefillApplied={onPrefillApplied}
      />
    </div>
  );
}
