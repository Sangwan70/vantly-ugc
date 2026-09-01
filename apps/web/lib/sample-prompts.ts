// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared example prompts for make_ugc / the Agent chat — full, ready-to-edit
 * requests (not just an opening line) so a new user can see exactly what a
 * good prompt looks like: a concrete script, a person/character choice, and
 * the style knobs (look, captions, aspect ratio) that make_ugc actually
 * reads. Used by:
 *  - /dashboard/agent — as quick-start chips under the composer.
 *  - /dashboard/docs  — as a "Sample prompts" reference section.
 */

export interface SamplePrompt {
  label: string;
  prompt: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    label: '🗣️ Talking-head UGC',
    prompt: "I want to make a talking-head UGC video.\n\n"
      + "Script: \"Okay this genuinely changed how I plan my week — I used to open five different apps just to remember what was due, now it's one glance and I know exactly what's next.\"\n\n"
      + "Person: a friendly 27-year-old woman, soft natural daylight, casual candid framing (or I can upload a photo / reuse a saved character instead).\n"
      + "Look: natural. Captions: on, TikTok style. Aspect ratio: 9:16.",
  },
  {
    label: '🛍️ Product review',
    prompt: "I want to make a product review video. I'll attach a photo of the product.\n\n"
      + "Script: \"I've tried so many phone stands and this is the first one that doesn't wobble — solid metal, folds flat for travel, and it still works with my case on.\"\n\n"
      + "Person: an enthusiastic person in a bright kitchen, holding the product up to camera.\n"
      + "Look: commercial. Captions: on, Hormozi style. Aspect ratio: 9:16.",
  },
  {
    label: '🎉 Hype clip (5s)',
    prompt: "I want a 5-second hype clip — no dialogue, just energy.\n\n"
      + "Scene: throwing both hands up and cheering straight at the camera, bright colorful background, quick punchy motion.\n"
      + "Use my saved character if I have one — otherwise generate a new person first.\n"
      + "Look: raw_iphone, for an authentic feel. Aspect ratio: 9:16.",
  },
  {
    label: '✨ New character',
    prompt: "I want to create a new reusable character I can use across future videos.\n\n"
      + "Description: a warm, approachable 30-year-old woman, curly brown hair, friendly smile, casual streetwear style.\n"
      + "(Or: I'll upload a reference photo and you build the character sheet from it.)\n\n"
      + "Keep her look consistent so I can reuse her by name in later requests.",
  },
  {
    label: '🎬 Product B-roll review',
    prompt: "I want to narrate over my own product B-roll footage instead of generating a scene.\n\n"
      + "B-roll video URL: https://…mp4 (footage of the product in use)\n\n"
      + "Script: \"Watch how easy this is to set up — no tools, no instructions, just clip it in and you're done.\"\n\n"
      + "Person: reuse my saved character, or describe one. Captions: on, minimal style. Aspect ratio: 9:16.",
  },
  {
    label: '💃 Silent action clip',
    prompt: "I want a short silent clip — no script, just a person doing something on camera.\n\n"
      + "Scene: dancing freestyle to an upbeat song, smiling at the camera, casual outfit, bright studio background.\n"
      + "This needs a saved character — I'll pick one, or create one first if I don't have one yet.\n"
      + "Look: natural. Aspect ratio: 9:16.",
  },
];
