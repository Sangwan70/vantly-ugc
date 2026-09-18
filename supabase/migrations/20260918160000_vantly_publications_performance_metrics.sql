-- vantly_publications: performance metrics columns (Video Generation Flow
-- audit, §6 improvement #7: "close the loop with published performance
-- data ... pulling basic performance metrics back (views, completion rate,
-- CTR where the platform exposes it) and surfacing them next to the
-- generation that produced the video").
--
-- Why `metrics_source` is CHECKed to 'manual' only, for now: our only
-- publishing integration is Vantly (a self-hosted Postiz fork -- see
-- lib/vantly.ts). Postiz's public API has exactly one endpoint that
-- returns anything about a post after it's live (List Posts /
-- GET /public/v1/posts), and it returns delivery status (state) and a
-- permalink (releaseURL) only -- no views, completion rate, or CTR, and
-- Postiz has no lifecycle webhooks either (both facts already documented
-- on listPosts in lib/vantly.ts). There is currently no automated path to
-- pull real engagement numbers back into vantly-ugc: that would mean a
-- direct per-platform Marketing/Insights API integration (Meta Graph API,
-- TikTok Display API, etc.), which is the same class of work as this
-- audit's own improvement #8 ("direct ad-platform launch"), scoped there
-- as its own discovery spike rather than assumed here.
--
-- So this ships the half of #7 that IS honestly buildable today: a place
-- to record real numbers (manual entry, e.g. copied from the platform's
-- own native analytics) and surface them next to the generation that
-- produced the video -- see GET /v1/social/performance in
-- routes/v1/social.ts for the "this hook/actor combo performed better"
-- rollup. `metrics_source` stays a CHECK-constrained enum (not a free
-- string) specifically so a future automated source (e.g.
-- 'platform_api') is a one-line CHECK change, not a new column.

ALTER TABLE public.vantly_publications
    ADD COLUMN IF NOT EXISTS metrics_views integer,
    ADD COLUMN IF NOT EXISTS metrics_completion_rate numeric,
    ADD COLUMN IF NOT EXISTS metrics_ctr numeric,
    ADD COLUMN IF NOT EXISTS metrics_source text,
    ADD COLUMN IF NOT EXISTS metrics_updated_at timestamptz;

ALTER TABLE public.vantly_publications DROP CONSTRAINT IF EXISTS vantly_publications_metrics_source_check;
ALTER TABLE public.vantly_publications
    ADD CONSTRAINT vantly_publications_metrics_source_check CHECK (metrics_source IS NULL OR metrics_source IN ('manual'));

ALTER TABLE public.vantly_publications DROP CONSTRAINT IF EXISTS vantly_publications_metrics_range;
ALTER TABLE public.vantly_publications
    ADD CONSTRAINT vantly_publications_metrics_range CHECK (
        (metrics_views IS NULL OR metrics_views >= 0)
        AND (metrics_completion_rate IS NULL OR (metrics_completion_rate >= 0 AND metrics_completion_rate <= 1))
        AND (metrics_ctr IS NULL OR (metrics_ctr >= 0 AND metrics_ctr <= 1))
    );

COMMENT ON COLUMN public.vantly_publications.metrics_views IS 'Raw view count, as reported by the platform''s own analytics UI and entered by the user (or a future automated source). NULL = no metrics recorded yet.';
COMMENT ON COLUMN public.vantly_publications.metrics_completion_rate IS 'Fraction [0,1] of viewers who watched to the end (platform terminology varies: "average % viewed", "completion rate", etc). NULL = not recorded / not exposed by this platform.';
COMMENT ON COLUMN public.vantly_publications.metrics_ctr IS 'Fraction [0,1] click-through rate, only meaningful where the platform exposes it (mainly paid/ad placements, per the audit doc''s own "where the platform exposes it" qualifier). NULL = not recorded / not applicable.';
COMMENT ON COLUMN public.vantly_publications.metrics_source IS 'How metrics_* were populated. Only ''manual'' exists today (see this migration''s header comment) -- CHECK-constrained so adding an automated source later is a one-line change.';
COMMENT ON COLUMN public.vantly_publications.metrics_updated_at IS 'When metrics_* were last written. NULL until first recorded; also used by GET /v1/social/performance to filter to publications that actually have metrics.';

-- GET /v1/social/performance's own query: published rows with metrics, most
-- recently updated first.
CREATE INDEX IF NOT EXISTS idx_vantly_publications_metrics
    ON public.vantly_publications (user_id, metrics_updated_at DESC)
    WHERE metrics_updated_at IS NOT NULL;
