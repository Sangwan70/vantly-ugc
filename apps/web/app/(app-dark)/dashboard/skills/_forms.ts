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
  // Repeatable ordered A/B dialogue list for make_podcast. Each row is one
  // turn: which of the two actors (A or B) speaks, and their line (5+
  // words -- a take needs to fill at least a 5s clip). Value is an array
  // of { speaker: 'A' | 'B', line } objects.
  | { kind: 'turn-list'; name: string; label: string; max: number; help?: string }
  // ONE required character identity, presented as three radio choices
  // instead of several always-visible fields -- the "how do you want to
  // supply this character" decision made explicit:
  //   - Generate Required Character Images (default): a plain text
  //     description, written to `generateField`.
  //   - Upload Your Own: a photo upload, written to `uploadField` as a
  //     base64 data URL.
  //   - Select Existing Characters: a saved character / stock actor
  //     picker, written to `existingField`.
  // Switching modes clears the other two fields so only one identity
  // source is ever submitted, same rule as `exclusiveGroups` below.
  // `generateViaPortrait` marks a skill (make_podcast) whose real field
  // only ever accepts a saved character or an image URL -- never a bare
  // description -- so RunPanel resolves "Generate" mode by drafting a
  // quick make_portrait image from the text FIRST, then submitting its
  // result as if the user had picked an existing character. Omit it (as
  // make_ugc does) when the skill's own field already accepts a plain
  // text description directly.
  | {
      kind: 'character-source'; name: string; label: string;
      generateField: string; generatePlaceholder?: string;
      uploadField: string;
      existingField: string;
      generateViaPortrait?: boolean;
      help?: string;
    }
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
  | { kind: 'expandable'; name: string; label: string; child: Field }
  // AI-drafting panel for the "bare minimum: just type a prompt" flow on
  // make_podcast/make_storybook -- sits ABOVE the manual editor(s) it fills
  // (turn-list for podcast; character-list + scene-list for storybook) so a
  // generated draft is always a fully editable starting point, never a
  // black box. `name` is a UI-only key (prefixed with `_` by convention so
  // RunPanel's submit strips it); mode picks the endpoint
  // (/v1/assist/draft-podcast or /v1/assist/draft-storybook) and which
  // sibling fields the result is written into via onChangeAny.
  | { kind: 'ai-draft-panel'; name: string; label: string; mode: 'podcast' | 'storybook'; help?: string };

export interface SkillForm {
  fields: Field[];
  composed: boolean;
  /** Groups of field names where the backend accepts at most one set —
   *  e.g. make_ugc's person/image/character identity. RunPanel clears the
   *  other names in a group the moment one of them gets a real value, so
   *  the conflict can never reach the server (previously: submitting both
   *  a typed Person description AND an attached photo 400'd with "pass at
   *  most one of person, image, or character"). */
  exclusiveGroups?: string[][];
  /** Cross-field check for backend invariants too conditional for a
   *  static `required` flag (e.g. make_ugc's "a long script needs a real
   *  face, not just a text description" — only true once the script gets
   *  long, or once a b-roll URL / product photo is set). Returns a
   *  message to show and block submit on, or null once satisfied.
   *  RunPanel re-runs it on every change so the Generate button disables
   *  itself live instead of letting the user hit a 400 first. */
  validate?: (values: Record<string, unknown>) => string | null;
}

// Mirrors SINGLE_CLIP_MAX_WORDS / isLongScript in
// services/api-v2/src/skills/make-ugc-router.ts — a script this long needs
// the multi-take engine, which (per dispatchMakeUgc in
// services/api-v2/src/routes/v1/skills.ts) requires a real face (a photo
// or a saved character), not just a text description. Keep both in sync.
const SINGLE_CLIP_MAX_WORDS = 33;
function isLongScript(script: string): boolean {
  if (!script) return false;
  if (/(?:^|\n)\s*---\s*(?:\n|$)/.test(script)) return true;
  return script.trim().split(/\s+/).filter(Boolean).length > SINGLE_CLIP_MAX_WORDS;
}

/**
 * Mirrors the identity requirements decideMakeUgcRoute()
 * (services/api-v2/src/skills/make-ugc-router.ts) actually enforces per
 * route, so the composer can require the right thing BEFORE submit
 * instead of surfacing whatever 400 the server happens to send back:
 *  - a product photo routes to make_product_in_hands, which only ever
 *    resolves a SAVED CHARACTER as the holder — an attached photo or a
 *    person description is silently useless there.
 *  - a b-roll URL, or a script long enough to need multiple takes, routes
 *    to make_broll_talking_head, which needs a consistent face across
 *    takes — a photo or a saved character, never just a text description.
 *  - a silent clip (scene_action, no script) only reaches an engine that
 *    plays it when a saved character is attached; without one the action
 *    is silently dropped rather than rejected, which is worse than a 400.
 */
function validateMakeUgc(v: Record<string, unknown>): string | null {
  const script = String(v.script ?? '').trim();
  const sceneAction = String(v.scene_action ?? '').trim();
  const character = String(v.character ?? '').trim();
  const image = String(v.image ?? '').trim();
  const productImage = String(v.product_image ?? '').trim();
  const brollUrl = String(v.broll_url ?? '').trim();
  const hasFace = Boolean(image) || Boolean(character);

  if (!script && !sceneAction) {
    return 'Add a script (what they say) or a silent-clip action before generating.';
  }
  if (productImage && !character) {
    return 'A product video needs a saved character to hold it — pick one under "Use Saved Characters".';
  }
  if (brollUrl && !hasFace) {
    return 'A b-roll video needs a face to narrate it — attach a photo (the + on the script box) or pick a saved character.';
  }
  if (script && isLongScript(script) && !hasFace) {
    return 'This script is long enough to need multiple takes, which needs a consistent face — a text description alone isn\u2019t enough. Attach a photo (the + on the script box) or pick a saved character.';
  }
  if (sceneAction && !script && !character) {
    return 'A silent clip needs a saved character to perform it — pick one under "Use Saved Characters".';
  }
  return null;
}

/**
 * Mirrors what dispatchMakePodcast (services/api-v2/src/routes/v1/skills.ts)
 * actually requires: each of the two characters needs SOME identity source
 * (a generated description, an uploaded photo, or a saved/existing
 * character — matching the three character-source radio modes), and the
 * conversation needs at least one real line.
 */
function validateMakePodcast(v: Record<string, unknown>): string | null {
  const hasA =
    Boolean(String(v.character_a ?? '').trim()) ||
    Boolean(String(v.character_a_base64 ?? '').trim()) ||
    Boolean(String(v._character_a_desc ?? '').trim());
  const hasB =
    Boolean(String(v.character_b ?? '').trim()) ||
    Boolean(String(v.character_b_base64 ?? '').trim()) ||
    Boolean(String(v._character_b_desc ?? '').trim());
  if (!hasA) return 'Character A needs an identity — generate one from a description, upload a photo, or pick an existing character.';
  if (!hasB) return 'Character B needs an identity — generate one from a description, upload a photo, or pick an existing character.';
  const script = Array.isArray(v.script) ? (v.script as Array<{ speaker?: string; line?: string }>) : [];
  if (script.filter((t) => t.speaker && t.line?.trim()).length === 0) {
    return 'Add at least one line of dialogue before generating.';
  }
  return null;
}

export const FORMS: Record<string, SkillForm> = {
  make_ugc: {
    composed: true,
    exclusiveGroups: [['person', 'image', 'character']],
    validate: validateMakeUgc,
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
  make_podcast: {
    composed: true,
    validate: validateMakePodcast,
    fields: [
      { kind: 'character-source', name: 'character_a', label: 'Character A', generateField: '_character_a_desc', generatePlaceholder: 'e.g. a warm, curious podcast host in their 30s, glasses, casual sweater', uploadField: 'character_a_base64', existingField: 'character_a', generateViaPortrait: true, help: 'Who speaks the \'A\' lines below.' },
      { kind: 'character-source', name: 'character_b', label: 'Character B', generateField: '_character_b_desc', generatePlaceholder: 'e.g. a friendly guest in their 40s, relaxed, warm smile', uploadField: 'character_b_base64', existingField: 'character_b', generateViaPortrait: true, help: 'Who speaks the \'B\' lines below.' },
      // Bare-minimum path: type what they're discussing (+ optional source
      // URL + orientation) and POST /v1/assist/draft-podcast writes a full
      // conversation into `script` (and a `room` suggestion) below — still
      // a normal editable turn-list afterward, never auto-submitted.
      { kind: 'ai-draft-panel', name: '_ai_draft_podcast', label: 'Conversation', mode: 'podcast', help: 'Optional — describe the topic and generate a full back-and-forth, or just write the turns below by hand.' },
      // 24 mirrors PODCAST_MAX_TURNS in services/api-v2/src/skills/registry.ts.
      { kind: 'turn-list', name: 'script', label: 'Conversation (in order)', max: 24, help: 'Each turn needs 5+ words to fill a clip — the camera cuts to whoever speaks. Long lines auto-split into ≤ 15s takes.' },
      { kind: 'text', name: 'room', label: 'Studio / room look (optional)', placeholder: 'a warm modern podcast studio, two mics, wood desk', help: 'Defaults to a warm modern podcast studio.' },
      { kind: 'boolean', name: 'subtitles', label: 'Burn subtitles', defaultValue: false },
      { kind: 'select', name: 'subtitles_style', label: 'Subtitles style', options: ['hormozi', 'tiktok', 'minimal'], defaultValue: 'hormozi' },
    ],
  },
  make_storybook: {
    composed: true,
    fields: [
      { kind: 'text', name: 'title', label: 'Title (optional)', placeholder: 'Pip the Fox and the Lost Scarf' },
      // Bare-minimum path: type the story's premise (+ optional source URL)
      // and POST /v1/assist/draft-storybook writes a full cast + ordered
      // scenes into `characters`/`scenes` (and `title`, if left blank)
      // below -- this is "Auto Generate Required Characters" for the whole
      // story, not just one character; the cast/scene lists stay fully
      // editable afterward, never auto-submitted.
      { kind: 'ai-draft-panel', name: '_ai_draft_storybook', label: 'Story', mode: 'storybook', help: 'Optional — describe the premise and generate a cast + scenes, or build them below by hand.' },
      // 1-4 characters (STORYBOOK_MAX_CHARACTERS in @vantly-ugc/schema); each
      // row needs a name plus at least one identity source — a description
      // alone is the common case, matching MakeStorybookSkillInputSchema.
      { kind: 'character-list', name: 'characters', label: 'Characters (cast)', max: 4, help: 'Up to 4 characters. Each needs a name, plus a description, an uploaded photo, or a saved character — a description alone works great (e.g. "a curious fox cub in a blue scarf"). Or use "Story" above to auto-generate the whole cast from a one-line premise.' },
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
