-- Migration: register the loose-surface catalog ids so
-- generation_jobs.model_slug FK to public.models(slug) resolves, and
-- allow media_type = 'audio' for the new elevenlabs-tts row.
--
-- The loose surface (generate_image / generate_video / generate_audio,
-- services/api-v2/src/routes/v2/generate.ts) lets an agent pick a model
-- id straight from packages/schema/src/v2/models.ts (V2_MODELS) and that
-- id is written as generation_jobs.model_slug. Three of those live ids
-- (seedance-2.0, seedance-2.5, elevenlabs-tts) have never had a bare
-- public.models row before now — only pipeline-specific slugs like
-- seedance-2.0-selfie did — and gpt-image-2.5 / gpt-image-2.5-flare are
-- brand new models. Without this migration every loose-surface job
-- insert fails the FK and the user sees "Failed to create job".
--
-- Same pattern as 20260507000001_character_video_models.sql: these rows
-- are routing/labelling only, pricing comes from the catalog's own
-- credits table (packages/schema/src/v2/models.ts), not model_pricing —
-- so is_active=false keeps the check_pricing_coverage() trigger from
-- requiring a model_pricing row. The FK doesn't care about is_active.

-- ── 1. Allow media_type = 'audio' ───────────────────────────────────────
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_media_type_check;
ALTER TABLE models ADD CONSTRAINT models_media_type_check
  CHECK (media_type IN ('video', 'image', 'subtitle', 'ugc', 'audio'));

-- ── 2. Register the catalog ids the loose surface can select ───────────
INSERT INTO public.models (
  slug,
  display_name,
  description,
  media_type,
  provider_slug,
  provider_model_id,
  supports_text_to_video,
  supports_image_to_video,
  supports_text_to_image,
  max_duration_seconds,
  max_resolution,
  is_active
) VALUES
  (
    'seedance-2.0',
    'Seedance 2.0 (loose surface)',
    'The bare catalog id for generate_video, selectable across text / image-to-video / reference-to-video modes. See packages/schema/src/v2/models.ts for the full spec; pricing lives there, not in model_pricing.',
    'video',
    'evolink',
    'seedance-2.0-text-to-video',
    true, true, false,
    15, '1080p', false
  ),
  (
    'seedance-2.5',
    'Seedance 2.5 (loose surface)',
    'The bare catalog id for generate_video, selectable across text / image-to-video / reference-to-video modes. See packages/schema/src/v2/models.ts for the full spec; pricing lives there, not in model_pricing.',
    'video',
    'evolink',
    'seedance-2.5-text-to-video',
    true, true, false,
    15, '1080p', false
  ),
  (
    'gpt-image-2.5',
    'GPT Image 2.5 (loose surface, catalog default)',
    'Default image model for generate_image and every identity stage (portrait, character sheet, wireframe) inside the fixed video skills. See packages/schema/src/v2/models.ts.',
    'image',
    'openai',
    'gpt-image-2.5-sunburst',
    false, false, true,
    NULL, '1536x1536', false
  ),
  (
    'gpt-image-2.5-flare',
    'GPT Image 2.5 Flare (loose surface)',
    'Faster speed tier of the gpt-image-2.5 family, selectable via generate_image. See packages/schema/src/v2/models.ts.',
    'image',
    'openai',
    'gpt-image-2.5-flare',
    false, false, true,
    NULL, '1536x1536', false
  ),
  (
    'elevenlabs-tts',
    'ElevenLabs TTS (loose surface)',
    'The bare catalog id for generate_audio: text-to-speech, priced per character. See packages/schema/src/v2/models.ts.',
    'audio',
    'elevenlabs',
    'eleven_multilingual_v2',
    false, false, false,
    NULL, NULL, false
  )
ON CONFLICT (slug) DO NOTHING;
