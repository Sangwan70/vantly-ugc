// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * The agent page's "start creating" screen: a structured form rather than
 * a freeform chat prompt, so submitting always sends a well-formed request
 * (never the "provide either script or scene_action" class of error a
 * vague chat message could trigger from the LLM router).
 *
 * One line at the top reads as a sentence with two inline dropdowns:
 *   "Create a [video type] for [platform] using exactly this script.."
 * — video type picks one of three underlying skills:
 *   - the four original make_ugc identity shapes (a plain talking head / a
 *     product-in-hands ad / a b-roll narrated review / a silent action
 *     clip) — these stay one skill, make_ugc, with video type only
 *     narrowing which identity fields show;
 *   - Podcast (make_podcast) — two characters, a scripted A/B conversation;
 *   - Storybook (make_storybook) — 1-4 illustrated characters acting out
 *     ordered scenes.
 * Platform sets aspect_ratio (make_podcast only ever renders 9:16, so its
 * dropdown is locked). Everything below (script/scenes, music, language,
 * subtitles, watermark, character, voice actor) reuses the SAME per-skill
 * form + RunPanel the Skill Center already uses (see ../skills/_forms.ts,
 * ../skills/_run-panel.tsx) so submission, credit preflight, and the ETA
 * banner are all the exact same tested path — this component only adds
 * the header and picks which skill/fields show.
 */

import { useEffect, useMemo, useState } from 'react';
import { RunPanel, type RunResult, type SkillEntry } from '../skills/_run-panel';
import { FORMS, type Field } from '../skills/_forms';

type VideoType = 'talking_head' | 'product' | 'broll_review' | 'silent_action' | 'podcast' | 'storybook';
type Platform = '9:16' | '1:1';

const VIDEO_TYPE_OPTIONS: { value: VideoType; label: string }[] = [
  { value: 'talking_head', label: 'Talking-Head UGC' },
  { value: 'product', label: 'Product in Hands' },
  { value: 'broll_review', label: 'B-Roll Review' },
  { value: 'silent_action', label: 'Silent Action Clip' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'storybook', label: 'Storybook' },
];

// The trailing clause of the header sentence changes shape once the
// selected type moves past make_ugc's single `script` field -- podcast has
// an ordered A/B conversation instead, and storybook has a cast + ordered
// scenes instead. Falls back to the original wording for the four make_ugc
// shapes.
const TRAILING_TEXT_BY_TYPE: Partial<Record<VideoType, string>> = {
  podcast: 'with this conversation..',
  storybook: 'with these characters and scenes..',
};

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
// which are always available regardless of video type. Only applies to
// the four make_ugc shapes -- podcast/storybook use their own full form.
const IDENTITY_FIELDS_BY_TYPE: Record<'talking_head' | 'product' | 'broll_review' | 'silent_action', string[]> = {
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

export const MAKE_PODCAST_ENTRY: SkillEntry = {
  slug: 'make_podcast',
  name: 'Make Podcast',
  version: '1.0.0',
  description: 'Two characters recording a scripted podcast conversation.',
  primitive: 'composed:make_podcast',
};

export const MAKE_STORYBOOK_ENTRY: SkillEntry = {
  slug: 'make_storybook',
  name: 'Make Storybook',
  version: '1.0.0',
  description: "A short illustrated kids' story where characters talk on-screen.",
  primitive: 'composed:make_storybook',
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
  /** Which skill actually ran (make_ugc / make_podcast / make_storybook,
   *  matching whatever video type was selected) alongside the launched
   *  run -- the caller needs this to label/poll the run correctly instead
   *  of assuming make_ugc. */
  onGenerate: (skill: SkillEntry, result: RunResult) => void;
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

  // make_podcast's aspect_ratio is a fixed 9:16 literal server-side (see
  // MakePodcastSkillInputSchema) -- force the platform back to vertical
  // the moment Podcast is picked, and lock the dropdown below, rather than
  // letting a stale "Square" pick reach a skill that would 400 on it.
  useEffect(() => {
    if (videoType === 'podcast' && platform !== '9:16') setPlatform('9:16');
  }, [videoType, platform]);

  const activeSkillEntry = videoType === 'podcast' ? MAKE_PODCAST_ENTRY : videoType === 'storybook' ? MAKE_STORYBOOK_ENTRY : MAKE_UGC_ENTRY;

  const form = useMemo(() => {
    if (videoType === 'podcast') return FORMS.make_podcast;
    if (videoType === 'storybook') {
      // aspect_ratio is filtered out here too -- driven by the platform
      // dropdown instead, same as make_ugc below.
      const fields = FORMS.make_storybook.fields.filter((f) => f.name !== 'aspect_ratio');
      return { ...FORMS.make_storybook, fields };
    }
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
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} disabled={videoType === 'podcast'} title={videoType === 'podcast' ? 'Podcast always renders vertical (9:16)' : undefined} style={{ ...selectStyle, opacity: videoType === 'podcast' ? 0.5 : 1 }}>
          {PLATFORM_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span>{TRAILING_TEXT_BY_TYPE[videoType] ?? 'using exactly this script..'}</span>
      </div>

      <RunPanel
        key={`${videoType}-${platform}`}
        skill={activeSkillEntry}
        form={form}
        activeRun={null}
        onLaunched={(r) => onGenerate(activeSkillEntry, r)}
        initialValues={videoType === 'podcast' ? undefined : { aspect_ratio: platform }}
        submitLabel={videoType === 'podcast' ? 'Generate Podcast' : videoType === 'storybook' ? 'Generate Storybook' : 'Generate Video'}
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
