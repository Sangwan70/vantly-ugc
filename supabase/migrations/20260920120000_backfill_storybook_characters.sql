-- Backfill user_characters for storybook characters generated before the
-- auto-save fix landed (commit 84541b3, 2026-09-19).
--
-- Before that fix, make_storybook's character-design step
-- (primitive_id = 'storybook_character') never wrote to user_characters —
-- only make_character_sheet / make_ugc_video's character_sheet_gpt2 step did
-- (that one has auto-saved since its initial release). So anyone who
-- generated a storybook character before this date sees it rendered into
-- their finished video but it never appears in their saved-actors list on
-- /dashboard/actors. New storybook runs are covered going forward by the
-- autoSaveCharacter() call added to
-- services/primitive-worker-vnext/src/activities/storybook-character.ts;
-- this migration is the one-time catch-up for everything generated before
-- that call existed.
--
-- Mirrors that function's own logic exactly: dedup by (user_id,
-- character_sheet_url) so a row already saved (e.g. by a near-simultaneous
-- deploy) is skipped, source_kind = 'description' (the only CHECK-allowed
-- value for a design with no photo reference — see
-- 20260508120000_user_characters.sql), and a public_id minted the same way
-- 20260628080000_backfill_user_characters_public_id.sql did for the
-- equivalent character_sheet_gpt2 backfill.

INSERT INTO public.user_characters (
  user_id,
  name,
  source_kind,
  public_id,
  character_sheet_url,
  portrait_url,
  thumbnail_url,
  created_at
)
SELECT
  pr.user_id,
  left(coalesce(nullif(trim(pr.input->>'name'), ''), 'Untitled character'), 80),
  'description',
  'char_' || substr(md5(gen_random_uuid()::text), 1, 10),
  pa.url,
  pa.url,
  pa.url,
  pr.created_at
FROM public.primitive_runs pr
JOIN public.primitive_artifacts pa
  ON pa.primitive_run_id = pr.id
 AND pa.kind = 'storybook_character'
WHERE pr.primitive_id = 'storybook_character'
  AND pr.status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_characters uc
    WHERE uc.user_id = pr.user_id
      AND uc.character_sheet_url = pa.url
  );
