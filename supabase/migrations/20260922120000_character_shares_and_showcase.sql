-- Character sharing + marketing-showcase publishing, mirroring the
-- 2026-09-19 gallery_shares_and_showcase feature (see that migration's own
-- header comment) for user_characters instead of generation_jobs/runs.
--
-- character_shares -- an admin-pushed character, denormalized (name/urls
-- snapshot, not a live join to user_characters) so a shared copy keeps
-- rendering correctly even if the source character is later renamed,
-- archived, or its owner's account changes. Read by apps/web's GET
-- /api/dashboard/characters (merged into the recipient's own character
-- list -- and therefore into every skill's "reuse a saved character"
-- picker and the agent's list_my_characters tool, since they all read
-- that same endpoint -- tagged shared:true) and written only by
-- apps/web's admin routes (service-role client). Same trust-boundary
-- posture as gallery_shares: admin-only, no owner-initiated peer sharing.
CREATE TABLE IF NOT EXISTS public.character_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_with_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shared_by_label text,
  source_character_id uuid,
  name text,
  character_sheet_url text NOT NULL,
  portrait_url text,
  thumbnail_url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_shares_recipient
  ON public.character_shares (shared_with_user_id, created_at DESC);

ALTER TABLE public.character_shares ENABLE ROW LEVEL SECURITY;
-- No policies -- service-role only, same posture as gallery_shares. Reads
-- go through apps/web's GET /api/dashboard/characters (service-role
-- merge); writes go through apps/web's admin-gated
-- /api/admin/characters/share route (service role). No end user or anon
-- access.

-- showcase_items gains a `kind` column so the same table (and the same
-- admin add/list/delete route + rolling-window-of-10 trim logic) can hold
-- both published videos (the existing rows -- defaulted to 'video' so
-- they keep showing exactly where they already do) and published
-- characters (the new /showcase "Featured Characters" section), each
-- kept to its own rolling window of 10 rather than competing for one
-- shared window.
ALTER TABLE public.showcase_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'character'));

CREATE INDEX IF NOT EXISTS idx_showcase_items_kind_created
  ON public.showcase_items (kind, created_at DESC);
