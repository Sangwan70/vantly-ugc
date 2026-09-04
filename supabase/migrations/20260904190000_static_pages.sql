-- Admin Content Management: admin-editable copy for a handful of marketing
-- pages, replacing today's hardcoded JSX for the slugs an admin actually
-- edits. See the admin-replication-plan's "Admin Content Management"
-- section, scoped down per that document's own recommendation to start
-- with the highest-value slugs rather than converting every page at once.
--
-- Slug set is FIXED (validated server-side in the admin routes, not an
-- open text field an admin can invent new rows for) -- same reasoning as
-- AutoGPT's own StaticPage model. This first pass wires: pricing hero,
-- blog hero (clean PageHero-driven pages, low risk), and the full body of
-- privacy/terms (each keeps its existing "Last updated" / disclaimer
-- chrome and dynamic {{site_url}}/{{support_contact}} placeholders --
-- see apps/web/lib/content/render-vars.ts -- and only content_html itself
-- becomes DB-editable). The root landing page's hero is a bespoke animated
-- component (HeroSection), not a simple PageHero -- deliberately NOT wired
-- into this table; making that DB-driven would be a much larger, riskier
-- change to a highly-designed component, not what this milestone is for.
--
-- No row for a slug means "use today's hardcoded default" -- nothing
-- changes on this deploy until an admin actually edits a page. content_html
-- is sanitized server-side before being stored (see
-- apps/web/lib/content/sanitize-html.ts) -- it is rendered RAW on public
-- pages, so nothing writes to this column outside that sanitizer.
CREATE TABLE IF NOT EXISTS public.static_pages (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 text        UNIQUE NOT NULL,
    title                text        NOT NULL,
    content_html         text        NOT NULL DEFAULT '',
    hero_image_url       text,
    hero_video_url       text,
    hero_overlay_opacity integer     NOT NULL DEFAULT 45 CHECK (hero_overlay_opacity BETWEEN 0 AND 100),
    cta_primary_text     text,
    cta_secondary_text   text,
    updated_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.static_pages
    IS 'content_html is sanitized server-side before insert/update (see apps/web/lib/content/sanitize-html.ts) and rendered raw on public pages -- never write to this column any other way.';
COMMENT ON COLUMN public.static_pages.content_html
    IS 'Already-sanitized HTML. For pricing/blog this is unused (those slugs only use title as the H1 and no body); for privacy/terms this is the full policy body, may contain {{site_url}} / {{support_contact}} placeholders substituted at render time.';

DROP TRIGGER IF EXISTS trg_static_pages_updated ON public.static_pages;
CREATE TRIGGER trg_static_pages_updated BEFORE UPDATE ON public.static_pages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.static_pages ENABLE ROW LEVEL SECURITY;
-- No public policy -- public marketing pages are server components reading
-- this via the service-role client (server-side only, never exposed to the
-- browser), same convention as every other admin-adjacent config table
-- this session has added (site_settings, currencies, mailer_config, plans).
DROP POLICY IF EXISTS static_pages_service_all ON public.static_pages;
CREATE POLICY static_pages_service_all ON public.static_pages FOR ALL TO service_role USING (true) WITH CHECK (true);
