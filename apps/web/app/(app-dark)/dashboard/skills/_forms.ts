// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Hand-coded per-skill form definitions for the Skill Center detail
 * pages. Hand-coded today; the json_schema in /v1/skills could drive
 * this dynamically once we have a JSON-schema → React-form helper.
 */

export type Field =
  | { kind: 'text'; name: string; label: string; placeholder?: string; required?: boolean; textarea?: boolean; help?: string }
  | { kind: 'select'; name: string; label: string; options: string[]; defaultValue?: string; help?: string }
  | { kind: 'number-select'; name: string; label: string; options: number[]; defaultValue?: number }
  | { kind: 'boolean'; name: string; label: string; defaultValue?: boolean }
  // File drop-zone / picker → base64 data URL. Submitted under `name`
  // (e.g. product_image_base64); the API re-hosts it to R2.
  | { kind: 'image'; name: string; label: string; help?: string }
  // Visual grid of the caller's saved characters + the stock actor
  // catalog. Selecting a tile fills `name` with a bare character_sheet_url
  // (saved character) or portrait_url (stock actor) — both accepted as-is
  // by resolveCharacterSheetUrl() on the API side. A plain text fallback
  // stays available for pasting a char_... id or URL by hand.
  | { kind: 'character-picker'; name: string; label: string; placeholder?: string; help?: string }
  // Repeatable cast list for make_storybook. Each row is one character:
  // a name, plus at most one identity source (a description, an uploaded
  // photo, or a saved character/stock actor) — a description alone is the
  // common case. Value is an array of
  // { name, description?, ref?, ref_base64? } objects.
  | { kind: 'character-list'; name: string; label: string; max: number; help?: string }
  // Repeatable ordered scene list for make_storybook. Each row is one
  // scene: a speaking character (drawn from the sibling `charactersField`
  // list), their spoken line, and a visual description of the shot. Value
  // is an array of { speaker, line, visual_description } objects.
  | { kind: 'scene-list'; name: string; label: string; max: number; charactersField: string; help?: string }
  // Script textarea with a hover-reveal "Generate with AI" sparkle at its
  // right edge. Treats the CURRENT text as a one-line pitch, drafts a full
  // script via POST /v1/assist/draft-script, and replaces the box's
  // content with the result (still editable afterward).
  | {
      kind: 'script-ai'; name: string; label: string; placeholder?: string; help?: string;
      // Name of a sibling `image` field this box's "+" menu can also set
      // (reads a file straight to a base64 data URL, same as the `image`
      // kind) — lets the photo-upload path live inside the script box's
      // own corner button instead of a separate always-visible drop-zone.
      photoFieldName?: string;
    }
  // Voice Actor picker: lists ElevenLabs voices (GET /v1/voices/elevenlabs)
  // with a play-preview per voice. Value is a bare ElevenLabs voice_id, or
  // '' for the default AI voice.
  | { kind: 'voice-picker'; name: string; label: string; help?: string }
  // An on/off switch (NOT a raw checkbox) whose own value is a boolean at
  // `name`. When on, `children` render indented right below it; when
  // switched off, each child is reset to its own default so a stale value
  // typed while it was on never gets silently submitted. Use this instead
  // of a bare `boolean` field whenever the toggle gates one or more other
  // fields (e.g. Background Music -> Music Preference) so the dependency
  // is visible instead of two unrelated-looking rows sitting side by side.
  | { kind: 'toggle'; name: string; label: string; defaultValue?: boolean; help?: string; children?: Field[] }
  // A pill that expands to reveal exactly one wrapped field when clicked —
  // for a setting that's optional-with-a-sensible-default rather than a
  // real on/off switch (Language, Music Preference, Voice Actor). Unlike
  // `toggle`, `name` here is a UI-only key (prefixed with `_` by
  // convention so RunPanel's submit strips it) — the value that actually
  // gets submitted lives under `child.name`.
  | { kind: 'expandable'; name: string; label: string; child: Field };

export interface SkillForm {
  fields: Field[];
  composed: boolean;
}

export const FORMS: Record<string, SkillForm> = {
  make_ugc: {
    composed: true,
    fields: [
      { kind: 'script-ai', name: 'script', label: 'Script — what they say', placeholder: 'Paste your script here, or type your idea and click the sparkle to generate one…', help: 'Any length — a line makes one clip, a monologue makes a multi-take video. Never trimmed.', photoFieldName: 'image' },
      { kind: 'text', name: 'scene_action', label: '…or a silent clip (instead of a script)', placeholder: 'dancing freestyle, smiling at camera', help: 'Use instead of a script for a non-speech clip. Needs a saved character.' },
      { kind: 'text', name: 'person', label: 'Person (describe in words)', placeholder: 'a friendly young woman, soft daylight', help: 'OR attach a photo (the + on the script box) / use a saved character below — at most one.' },
      { kind: 'image', name: 'product_image', label: 'Product photo', help: 'A photo of the product to show/hold — turns this into a product ad. Needs a character above to hold it.' },
      { kind: 'text', name: 'broll_url', label: 'B-roll video URL', placeholder: 'https://…mp4 — narrated overlay / review', help: 'The person narrates over this footage.' },
      { kind: 'text', name: 'name', label: 'Name / vibe hint (optional)', placeholder: 'Sophia, 28' },
      // Settings — rendered as a wrapping row of expandable pills (see
      // RunPanel), matching the "Background music +", "Language +", …
      // reference layout: tap a pill to reveal just that one setting,
      // tap again to collapse it. Order matches the original spec list.
      { kind: 'expandable', name: '_character_exp', label: 'Use Saved Characters',
        child: { kind: 'character-picker', name: 'character', label: 'Saved character / stock actor', placeholder: 'char_… or a character_sheet_url', help: 'Pick a saved character or stock actor, or paste an id/URL.' },
      },
      { kind: 'toggle', name: 'background_music', label: 'Background Music', defaultValue: false },
      { kind: 'expandable', name: '_language_exp', label: 'Language',
        child: { kind: 'select', name: 'language', label: 'Language', options: ['en', 'es', 'hi', 'fr', 'de', 'pt', 'ar', 'ja', 'ko', 'zh'], defaultValue: 'en', help: 'Spoken-voice and subtitle language.' },
      },
      { kind: 'toggle', name: 'captions', label: 'Subtitles', defaultValue: false,
        children: [
          { kind: 'select', name: 'caption_style', label: 'Subtitle style', options: ['hormozi', 'tiktok', 'minimal'], defaultValue: 'hormozi' },
        ],
      },
      { kind: 'toggle', name: '_watermark_enabled', label: 'Watermark Text', defaultValue: false, help: 'Burned onto the final video, small and semi-transparent.',
        children: [
          { kind: 'text', name: 'watermark_text', label: 'Watermark text', placeholder: '@yourbrand' },
        ],
      },
      { kind: 'expandable', name: '_music_preference_exp', label: 'Music Preference',
        child: { kind: 'text', name: 'music_preference', label: 'Music preference', placeholder: 'lo-fi jazz, upbeat pop, cinematic…', help: 'Only used when Background Music is on.' },
      },
      { kind: 'expandable', name: '_voice_actor_exp', label: 'Voice Actors',
        child: { kind: 'voice-picker', name: 'voice_id', label: 'Voice Actor', help: 'Pick an ElevenLabs voice, or leave blank for the default AI voice.' },
      },
      { kind: 'select', name: 'look', label: 'Look', options: ['natural', 'commercial', 'raw_iphone'], defaultValue: 'natural' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1'], defaultValue: '9:16' },
    ],
  },
  make_portrait: {
    composed: false,
    fields: [
      { kind: 'text', name: 'description', label: 'Description', placeholder: 'a friendly 28yo woman, soft window daylight, candid framing', required: true, textarea: true },
      { kind: 'text', name: 'setting', label: 'Setting (optional)', placeholder: 'bright kitchen, neutral background' },
      { kind: 'select', name: 'realism_target', label: 'Realism', options: ['natural', 'commercial', 'raw_iphone'], defaultValue: 'natural' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['1:1', '9:16'], defaultValue: '1:1' },
    ],
  },
  make_character_sheet: {
    composed: false,
    fields: [
      { kind: 'text', name: 'portrait_url', label: 'Portrait URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/... — or use the upload below', help: 'Provide a URL OR upload a photo below (not both).' },
      { kind: 'image', name: 'portrait_image_base64', label: '…or upload a photo', help: 'PNG/JPEG. Use this OR the URL above — the character auto-saves to My Characters (see the Actors page) once it finishes.' },
      { kind: 'text', name: 'description', label: 'Description (≤10 words)', placeholder: 'Sara, 28 years old' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['1:1', '9:16'], defaultValue: '1:1' },
    ],
  },
  make_simple_selfie: {
    composed: false,
    fields: [
      { kind: 'text', name: 'character_sheet_url', label: 'Character sheet URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true },
      { kind: 'text', name: 'script', label: 'Script (speech mode)', placeholder: 'Honestly, this app changed my whole morning routine.', textarea: true, help: 'What they SAY (lip-synced). 2–4 words/sec. Leave empty for a non-speech clip and fill Scene action instead.' },
      { kind: 'text', name: 'scene_action', label: 'Scene action (non-speech mode)', placeholder: 'dancing freestyle to upbeat music, smiling at camera', help: 'What they DO, no dialogue. Use instead of script for dancing / b-roll / vibes.' },
      { kind: 'text', name: 'background_music', label: 'Background music (optional)', placeholder: 'lo-fi jazz — or leave empty' },
      { kind: 'number-select', name: 'duration', label: 'Duration (s)', options: [5, 10, 15], defaultValue: 10 },
      { kind: 'text', name: 'location', label: 'Location (optional)', placeholder: 'bright kitchen window light' },
      { kind: 'text', name: 'pose', label: 'Pose (optional)', placeholder: 'leaning slightly on counter' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1'], defaultValue: '9:16' },
    ],
  },
  make_product_in_hands: {
    composed: false,
    fields: [
      { kind: 'text', name: 'character_sheet_url', label: 'Character sheet URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true },
      { kind: 'text', name: 'product_image_url', label: 'Product image URL (any https URL)', placeholder: 'https://...jpg — or use the upload below', help: 'A photo of the product the actor will hold. Provide a URL OR upload a file below (not both). It is re-hosted to vantly-ugc R2 automatically.' },
      { kind: 'image', name: 'product_image_base64', label: '…or upload a product image', help: 'PNG/JPEG, ≤10 MB. Use this OR the URL above.' },
      { kind: 'text', name: 'subject', label: 'Subject (locks gender/appearance)', placeholder: 'a young woman', help: 'Recommended. e.g. "a young woman", "a man in his 40s" — stops a gendered product (e.g. a football kit) from drifting the person.' },
      { kind: 'select', name: 'framing', label: 'Framing', options: ['close_up', 'full_body'], defaultValue: 'close_up', help: 'close_up = chest-up holding the product. full_body = head-to-toe, for turn-arounds / showing the whole outfit.' },
      { kind: 'text', name: 'script', label: 'Script (speech mode)', placeholder: 'Okay I am obsessed with this — my hair has never felt softer.', textarea: true, help: 'What they SAY while holding the product (lip-synced). 2–4 words/sec. Leave empty for a silent demo and fill Scene action instead.' },
      { kind: 'text', name: 'scene_action', label: 'Scene action (non-speech mode)', placeholder: 'turning around slowly to show the full outfit front and back', help: 'How they demo the product, no dialogue. Use instead of script. Great with full_body framing.' },
      { kind: 'text', name: 'background_music', label: 'Background music (optional)', placeholder: 'lo-fi jazz — or leave empty' },
      { kind: 'number-select', name: 'duration', label: 'Duration (s)', options: [5, 10, 15], defaultValue: 10 },
      { kind: 'text', name: 'location', label: 'Location (optional)', placeholder: 'bright kitchen window light' },
      { kind: 'text', name: 'pose', label: 'Pose (optional)', placeholder: 'holding the product up near face' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1'], defaultValue: '9:16' },
    ],
  },
  make_subtitles: {
    composed: false,
    fields: [
      { kind: 'text', name: 'video_url', label: 'Video URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true },
      { kind: 'text', name: 'transcript', label: 'Transcript (optional)', placeholder: 'leave empty to auto-transcribe via Whisper', textarea: true },
      { kind: 'select', name: 'style', label: 'Style', options: ['hormozi', 'tiktok', 'minimal'], defaultValue: 'hormozi' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1', '16:9'], defaultValue: '9:16' },
    ],
  },
  make_wireframe: {
    composed: false,
    fields: [
      { kind: 'text', name: 'character_sheet_url', label: 'Character sheet URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true },
      { kind: 'text', name: 'script', label: 'Action script', placeholder: 'walks into bedroom, picks up phone, smiles, hits record, talks to camera', required: true, textarea: true, help: 'Short description of the action progression. gpt-image-2 will draw N numbered panels showing it.' },
      { kind: 'number-select', name: 'n_panels', label: 'Panels', options: [4, 6, 8, 10], defaultValue: 6 },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1', '16:9'], defaultValue: '9:16' },
    ],
  },
  make_lip_sync: {
    composed: false,
    fields: [
      { kind: 'text', name: 'image_url', label: 'Face image URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true, help: 'A portrait or character-sheet image of the person who will speak.' },
      { kind: 'text', name: 'audio_url', label: 'Your audio URL (R2-hosted)', placeholder: 'https://pub-...r2.dev/vnext/...', required: true, help: 'An MP3/WAV recording of the voice. The character lip-syncs to THIS audio — no text-to-speech, bring your own voice.' },
      { kind: 'number-select', name: 'duration', label: 'Duration (s)', options: [5, 10, 15], defaultValue: 10 },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1'], defaultValue: '9:16' },
    ],
  },
  make_ugc_video: {
    composed: true,
    fields: [
      { kind: 'text', name: 'description', label: 'Person description (leave empty if you pass a portrait_url instead)', placeholder: 'a friendly young woman, soft daylight', textarea: true },
      { kind: 'text', name: 'portrait_url', label: 'Portrait URL (optional, R2-hosted)' },
      { kind: 'text', name: 'character_description', label: 'Character one-liner (≤10 words)', placeholder: 'Sara, 28 years old' },
      { kind: 'text', name: 'script', label: 'Script', placeholder: 'Okay this is wild — try this.', required: true, textarea: true, help: '2–4 words per second of duration.' },
      { kind: 'number-select', name: 'duration', label: 'Duration (s)', options: [5, 10, 15], defaultValue: 10 },
      { kind: 'text', name: 'location', label: 'Location (optional)' },
      { kind: 'text', name: 'pose', label: 'Pose (optional)' },
      { kind: 'select', name: 'realism_target', label: 'Realism', options: ['natural', 'commercial', 'raw_iphone'], defaultValue: 'natural' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1'], defaultValue: '9:16' },
      { kind: 'boolean', name: 'subtitles', label: 'Burn subtitles', defaultValue: true },
      { kind: 'select', name: 'subtitles_style', label: 'Subtitles style', options: ['hormozi', 'tiktok', 'minimal'], defaultValue: 'hormozi' },
    ],
  },
  make_storybook: {
    composed: true,
    fields: [
      { kind: 'text', name: 'title', label: 'Title (optional)', placeholder: 'Pip the Fox and the Lost Scarf' },
      // 1-4 characters (STORYBOOK_MAX_CHARACTERS in @vantly-ugc/schema); each
      // row needs a name plus at least one identity source — a description
      // alone is the common case, matching MakeStorybookSkillInputSchema.
      { kind: 'character-list', name: 'characters', label: 'Characters (cast)', max: 4, help: 'Up to 4 characters. Each needs a name, plus a description, an uploaded photo, or a saved character — a description alone works great (e.g. "a curious fox cub in a blue scarf").' },
      { kind: 'select', name: 'art_style', label: 'Art style', options: ['flat_vector_cartoon', 'storybook_watercolor', 'crayon_sketch', 'felt_stopmotion', 'classic_storybook_ink'], defaultValue: 'flat_vector_cartoon' },
      { kind: 'text', name: 'style_notes', label: 'Style notes (optional)', placeholder: 'warm pastel palette, cozy autumn mood' },
      // Ordered scenes (1-12, STORYBOOK_MAX_SCENES); each speaker must match
      // a character name above.
      { kind: 'scene-list', name: 'scenes', label: 'Scenes (story, in order)', max: 12, charactersField: 'characters', help: 'Each scene needs a speaking character, their line (5+ words), and a visual description of the shot. 5–8 scenes is a good length for a short story.' },
      { kind: 'select', name: 'aspect_ratio', label: 'Aspect ratio', options: ['9:16', '1:1', '16:9'], defaultValue: '9:16' },
      { kind: 'boolean', name: 'subtitles', label: 'Burn subtitles', defaultValue: false },
      { kind: 'select', name: 'subtitles_style', label: 'Subtitles style', options: ['hormozi', 'tiktok', 'minimal'], defaultValue: 'hormozi' },
    ],
  },
};
