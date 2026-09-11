-- vantly_publications: generalize beyond the legacy-only automated
-- auto-publish flow so the manual "Publish a video" flow on
-- /dashboard/social (services/api-v2/src/routes/v1/social.ts's
-- publishSocialRoute) can write real per-channel status rows too, plus
-- add what a real platform permalink needs.
--
-- Why this is needed: vantly_publications was created (20260510140000)
-- and renamed (20260828150000) exclusively for the automated
-- webhook-provider "job.completed" flow, which only ever fires for
-- legacy public.generation_jobs rows (job_id NOT NULL REFERENCES
-- generation_jobs(id)). Most videos generated today go through the vNext
-- skill_runs/primitive_runs pipeline instead (e.g. make_storybook,
-- make_ugc_video) -- those never had ANY publish-status tracking, manual
-- or automated, because this table structurally couldn't reference them.
-- The manual publish flow needs to track exactly those videos, so this
-- generalizes the anchor the same way me-gallery.ts's GalleryItem already
-- does: a (source, run_id) pair instead of a hard generation_jobs FK.
--
-- See services/api-v2/src/routes/v1/social.ts and
-- apps/web/app/(app-dark)/dashboard/social/page.tsx for the application
-- code this supports.

-- job_id becomes optional: a manual-flow row anchors via source/run_id
-- instead, since most manually-published videos have no generation_jobs
-- row at all.
ALTER TABLE public.vantly_publications
    ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE public.vantly_publications
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS run_id text,
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS release_url text;

ALTER TABLE public.vantly_publications DROP CONSTRAINT IF EXISTS vantly_publications_origin_check;
ALTER TABLE public.vantly_publications
    ADD CONSTRAINT vantly_publications_origin_check CHECK (origin IN ('auto', 'manual'));

ALTER TABLE public.vantly_publications DROP CONSTRAINT IF EXISTS vantly_publications_has_anchor;
ALTER TABLE public.vantly_publications
    ADD CONSTRAINT vantly_publications_has_anchor CHECK (job_id IS NOT NULL OR run_id IS NOT NULL);

COMMENT ON COLUMN public.vantly_publications.source
    IS 'Mirrors me-gallery.ts GalleryItem.source (legacy|vnext_primitive|vnext_skill) for a manual-flow row. NULL for auto-flow rows (those still use job_id).';
COMMENT ON COLUMN public.vantly_publications.run_id
    IS 'Mirrors me-gallery.ts GalleryItem.run_id -- a skill_runs/primitive_runs/generation_jobs id as free text, no FK (same durable-breadcrumb convention as subscriptions.coupon_code), since it can point at any of three tables depending on source. Set by the manual /dashboard/social publish flow; NULL for auto-flow rows.';
COMMENT ON COLUMN public.vantly_publications.origin
    IS 'Which flow wrote this row: auto (webhook-provider job.completed fanout) or manual (/dashboard/social "Publish a video").';
COMMENT ON COLUMN public.vantly_publications.release_url
    IS 'The published post''s URL on the social platform, e.g. https://tiktok.com/@x/video/123. Postiz''s create-post response never includes this -- it is resolved by a follow-up call to GET /public/v1/posts (List Posts) once the post has had time to actually go live. NULL until resolved, and may stay NULL if the platform/Postiz never returns one.';

-- Manual flow's status lookups (parallels the existing job_id index).
CREATE INDEX IF NOT EXISTS idx_vantly_publications_user_run
    ON public.vantly_publications (user_id, run_id);

-- Idempotency backstop: a genuine double-submit race (two concurrent
-- requests publishing the same video to the same channel) can't create
-- two live rows. Once a row's status becomes 'failed' it drops out of
-- this partial index's predicate, so a legitimate retry after a failure
-- is never blocked -- only a currently in-flight or already-succeeded
-- publish of the exact same (user, video, channel) is.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vantly_publications_dedup
    ON public.vantly_publications (user_id, run_id, integration_id)
    WHERE run_id IS NOT NULL AND status IN ('pending', 'uploaded', 'published');

COMMENT ON TABLE public.vantly_publications
    IS 'Audit log + live status of every Vantly (Postiz) publish fanout, one row per (video, integration). origin=auto rows come from the webhook-provider job.completed flow (job_id set, run_id NULL); origin=manual rows come from /dashboard/social (run_id/source set, job_id NULL unless the video happens to also be a legacy generation_jobs row). idx_vantly_publications_dedup enforces at most one live (pending/uploaded/published) row per (user, run_id, integration_id).';
