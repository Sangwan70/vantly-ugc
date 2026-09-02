// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Per-art-style prompt language for make_storybook, shared by BOTH the
 * character-design step (storybook-character.ts) and the per-scene video step
 * (storybook-take.ts) so a story's character sheet and its animated takes
 * always agree on the same visual language — the one thing that must never
 * drift between those two activities.
 *
 * Keys come from @vantly-ugc/schema's STORYBOOK_ART_STYLE_KEYS, the same list
 * the user-facing Zod schema validates against (services/api-v2/src/skills/
 * registry.ts) — importing the type here (rather than re-declaring the key
 * list) means a style added to one side and forgotten on the other is a
 * compile error, not a silent runtime mismatch.
 */

import type { StorybookArtStyle } from '@vantly-ugc/schema';

export const STORYBOOK_ART_STYLES: Record<StorybookArtStyle, string> = {
  flat_vector_cartoon:
    'flat vector cartoon illustration style: bold clean black outlines, simple flat color fills, no gradients, no photorealistic shading or texture, big expressive eyes, friendly kids storybook character design',
  storybook_watercolor:
    'soft watercolor storybook illustration style: gentle painterly brushstrokes, visible paper texture, muted warm color palette, soft edges rather than hard outlines, classic picture-book charm',
  crayon_sketch:
    'hand-drawn crayon and colored-pencil illustration style: visible waxy crayon strokes and texture, slightly imperfect childlike linework, bright saturated colors, warm handmade picture-book feel',
  felt_stopmotion:
    'felt and fabric stop-motion puppet style: soft felted-wool textures, visible stitching and fabric grain, plush handcrafted look like a stop-motion animated film character, warm tactile lighting',
  classic_storybook_ink:
    'classic storybook ink-and-wash illustration style: fine pen-and-ink linework with soft watercolor wash coloring, vintage children\'s-book engraving charm, warm nostalgic palette',
};
