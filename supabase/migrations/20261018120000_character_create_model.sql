-- Migration: register the v2 character-create model slug so
-- generation_jobs.model_slug FK to public.models(slug) resolves.
--
-- POST /v2/characters (services/api-v2/src/routes/v2/characters.ts) inserts a
-- generation_jobs row with model_slug = 'gpt-image-2-character'. That slug was
-- never registered in public.models, so the insert failed the FK and every
-- character created from a description (dashboard Actors page, CLI
-- `vantly-ugc character create`, MCP create_character) returned
-- "Failed to create job".
--
-- Same pattern as 20260507000001_character_video_models.sql and
-- 20260911120000_loose_surface_models.sql: a routing/labelling row only.
-- Pricing comes from credit_cost on the job row, so is_active=false keeps the
-- check_pricing_coverage() trigger from requiring a model_pricing row. The FK
-- does not care about is_active.

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
) VALUES (
  'gpt-image-2-character',
  'Character create (gpt-image-2)',
  'Reusable character created from a description and/or one photo: portrait plus multi-pose character sheet, with a pinned video seed. Used by POST /v2/characters.',
  'image',
  'openai',
  'gpt-image-2',
  false, false, true,
  NULL, '1536x1536', false
)
ON CONFLICT (slug) DO NOTHING;
