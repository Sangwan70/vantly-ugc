-- Blog CMS: real, admin-authored blog posts, replacing the hardcoded
-- 3-entry POSTS array in apps/web/app/blog/page.tsx. Matches AutoGPT's
-- own BlogPost model (id, slug, title, excerpt, coverImageUrl,
-- contentHtml, status draft/published/archived, seoDescription,
-- publishedAt) -- see the content-management audit's Blog CMS gap.
--
-- content_html goes through the same sanitizeStaticPageHtml() as
-- static_pages.content_html (see apps/web/lib/content/sanitize-html.ts)
-- before every insert/update -- it is rendered RAW via
-- dangerouslySetInnerHTML on the public post-detail page, so the same
-- security boundary applies here.
--
-- Same RLS convention as static_pages: no public policy. The public
-- blog listing/detail pages are server components that read this via
-- the service-role client (server-side only), explicitly filtering
-- status = 'published' themselves -- see apps/web/lib/content/get-blog-posts.ts.
CREATE TABLE IF NOT EXISTS public.blog_posts (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             text        UNIQUE NOT NULL,
    title            text        NOT NULL,
    excerpt          text        NOT NULL DEFAULT '',
    cover_image_url  text,
    content_html     text        NOT NULL DEFAULT '',
    status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    seo_description  text,
    published_at     timestamptz,
    created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.blog_posts
    IS 'content_html is sanitized server-side before insert/update (see apps/web/lib/content/sanitize-html.ts) and rendered raw on the public post page -- never write to this column any other way.';

CREATE INDEX IF NOT EXISTS blog_posts_status_published_at_idx
    ON public.blog_posts (status, published_at DESC);

DROP TRIGGER IF EXISTS trg_blog_posts_updated ON public.blog_posts;
CREATE TRIGGER trg_blog_posts_updated BEFORE UPDATE ON public.blog_posts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blog_posts_service_all ON public.blog_posts;
CREATE POLICY blog_posts_service_all ON public.blog_posts FOR ALL TO service_role USING (true) WITH CHECK (true);
