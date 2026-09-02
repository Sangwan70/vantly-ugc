// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * make_storybook shared constants — art style keys are the single source of
 * truth for BOTH the user-facing input schema (services/api-v2/src/skills/
 * registry.ts's z.enum) and the worker's per-style prompt-language map
 * (services/primitive-worker-vnext/src/lib/storybook-styles.ts). Defining the
 * key list once here means the two can never drift apart — the failure mode
 * this session already hit once with the podcast take-chunker (see
 * take-planner.ts's header comment) and is worth not repeating.
 */

export const STORYBOOK_ART_STYLE_KEYS = [
  'flat_vector_cartoon',
  'storybook_watercolor',
  'crayon_sketch',
  'felt_stopmotion',
  'classic_storybook_ink',
] as const;

export type StorybookArtStyle = (typeof STORYBOOK_ART_STYLE_KEYS)[number];

/** 1-4 characters per story — enough cast for a scene, small enough that each
 *  gets a real per-character locked design (a free gpt-image-2 step apiece). */
export const STORYBOOK_MAX_CHARACTERS = 4;

/** Ordered scenes in one story. 12 keeps a run's total render time reasonable
 *  (each scene is at least one paid Seedance take). */
export const STORYBOOK_MAX_SCENES = 12;
