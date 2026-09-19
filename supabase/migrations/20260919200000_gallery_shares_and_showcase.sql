-- Admin-curated content sharing + public marketing showcase.
--
-- Two independent, unrelated tables added together because both back the
-- same feature request (admin: selectively push a generation into another
-- user's gallery, or onto the public "See what Vantly UGC produces" page):
--
--   gallery_shares  -- an admin-pushed generation, denormalized (URL/label
--                       snapshot, not a live join) so it keeps rendering
--                       correctly even if the source run/artifact is later
--                       deleted or the sharing admin's account changes.
--                       Read by services/api-v2's GET /v1/me/gallery
--                       (merged into the recipient's own feed, tagged
--                       shared:true) and written only by apps/web's admin
--                       routes (service-role client) -- no end-user access,
--                       by design (2026-09-19 feature discussion: admin-only
--                       sharing, no team/follow model exists in this app).
--
--   showcase_items  -- the curated list behind /showcase (previously a
--                       hardcoded array in apps/web/app/showcase/page.tsx).
--                       Intentionally publicly readable (RLS policy below)
--                       since it's marketing content by definition; still
--                       only admin-writable via the service-role client.
--                       Callers enforce the "rolling window of 10" by
--                       trimming on insert -- see apps/web's
--                       app/api/admin/showcase/route.ts POST handler --
--                       not a DB-level constraint, since "keep the 10 most
--                       recent" is simpler to express and reason about in
--                       application code than in a trigger.

CREATE TABLE IF NOT EXISTS public.gallery_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_with_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalized snapshot of who shared it, so the recipient's "Shared by
  -- X" badge still reads correctly even after shared_by_user_id goes NULL
  -- (admin account deleted) or the admin's email/name later changes.
  shared_by_label text,
  source_kind text NOT NULL CHECK (source_kind IN ('legacy', 'vnext_skill', 'vnext_primitive')),
  source_run_id uuid,
  primitive text,
  media_url text NOT NULL,
  thumbnail_url text,
  duration_seconds numeric,
  title text,
  prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_shares_recipient
  ON public.gallery_shares (shared_with_user_id, created_at DESC);

ALTER TABLE public.gallery_shares ENABLE ROW LEVEL SECURITY;
-- No policies -- service-role only, same posture as primitive_runs/skill_runs
-- (see 20260527150000_vnext_primitive_runs.sql's header comment). Reads go
-- through api-v2's GET /v1/me/gallery (service role); writes go through
-- apps/web's admin-gated routes (service role). No end user or anon access.

CREATE TABLE IF NOT EXISTS public.showcase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_url text NOT NULL,
  label text,
  source_run_id uuid,
  added_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_showcase_items_created
  ON public.showcase_items (created_at DESC);

ALTER TABLE public.showcase_items ENABLE ROW LEVEL SECURITY;

-- Marketing content: deliberately public. Writes still require the
-- service-role client (admin routes) -- this policy only ever grants SELECT.
CREATE POLICY showcase_items_public_read ON public.showcase_items
  FOR SELECT
  TO anon, authenticated
  USING (true);
