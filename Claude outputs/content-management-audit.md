# Content Management: AutoGPT vs. Vantly — Full Audit

Scope of this audit: (1) a complete inventory of what AutoGPT's actual
Content Management feature contains, (2) a complete inventory of what
exists in Vantly today, (3) exactly which live Vantly pages consume which
fields, and (4) every deviation between the two, itemized and categorized
by why it exists. This is an honest self-audit of the work done in this
session, not a defense of it.

**Headline finding**: the two systems are not byte-for-byte equivalent.
AutoGPT's "Content Management" is actually three separate features bolted
into one admin page (static pages, a full blog CMS, and product-page
management), plus a hero-image cropping tool. What was built in Vantly
this session only touches one of those three (static pages), and even
there it deliberately imported UI patterns (drag-and-drop rows/blocks,
themes, saved blocks) from a *fourth*, unrelated AutoGPT feature (the
Mailer template builder) rather than replicating StaticPageEditor as-is.
That substitution was discussed and approved in our scope conversation,
but "same capabilities" and "byte for byte" are different bars, and this
document holds the work to the second one.

---

## Part A — AutoGPT's actual Content Management surface

Source: `/Users/info/labs/AutoGPT/autogpt_platform/frontend/src/app/(platform)/admin/content-management/`

### A1. Nine tabs, one page

`ContentManagementClient.tsx` renders 9 tabs, each backed by its own
`StaticPage` database row (or, for Blog, a whole separate model):

| Tab | Backing | Rich body? | Hero media? | CTA? |
|---|---|---|---|---|
| Home | `static_pages` slug `home-hero` | Yes | Yes | No |
| Privacy Policy | slug `privacy-policy` | Yes | No | No |
| Terms of Use | slug `terms-of-use` | Yes | No | No |
| Contact Us | slug `contact-us` | Yes | No | No |
| Blog | separate `BlogPost` table, full CRUD | Yes (per post) | cover image | N/A |
| Products (4 sub-tabs: AutoPilot/Agents/Marketplace/Build) | 4 slugs | Yes | Yes | Yes |
| Pricing Hero | slug `pricing-hero` | No (plain subtitle) | Yes | No |
| Blog Hero | slug `blog-hero` | No | Yes | No |
| Docs Hero | slug `docs-hero` | No | Yes | No |

### A2. The `StaticPage` Prisma model

`backend/schema.prisma` (line ~3265):
```
model StaticPage {
  id, slug (unique), title, contentHtml
  heroImageUrl, heroVideoUrl, heroOverlayOpacity (0-100, default 45)
  ctaPrimaryText, ctaSecondaryText
  createdAt, updatedAt, updatedBy
}
```

### A3. The `BlogPost` Prisma model — entirely separate system

`backend/schema.prisma` (line ~3241): `id, slug (unique), title, excerpt,
coverImageUrl, contentHtml, status (DRAFT/PUBLISHED/ARCHIVED),
seoDescription, publishedAt, createdAt, updatedAt, createdBy`.

Full CRUD UI: `BlogPostsManager.tsx` (table: title/slug/status/published
date/edit/delete), `BlogPostFormDialog.tsx` (title, auto-slug-from-title,
cover image upload, status dropdown, excerpt, SEO description, and a full
`BlogPostEditor` rich-text body), `DeleteBlogPostDialog.tsx` (confirm).
Server actions in `admin/blog/actions.ts` call a real backend
(`listBlogPosts`, `createBlogPost`, `updateBlogPost`, `deleteBlogPost`)
and `revalidatePath` both `/admin/blog`, `/blog`, and `/blog/{slug}` on
every write.

**This entire system does not exist in Vantly.** Vantly's "blog" tab is a
single hero-title row with no body, no list, no per-post anything.
Vantly's public `/blog` page is a hardcoded array of 3 fake posts in the
page source (`app/blog/page.tsx`), unconnected to any database table.

### A4. Product pages — platform-specific, not portable as-is

`ProductPagesEditor.tsx` manages 4 sub-tabs (`/products/autopilot`,
`/products/agents`, `/products/marketplace`, `/products/build`), each a
full `StaticPageEditor` with hero media + CTA. Vantly has no `/products/*`
route tree at all — this is a structural difference in what the two
apps actually sell, not a missed port. Flagged for completeness, not
counted as a deviation to fix.

### A5. `StaticPageEditor.tsx` — the actual "WYSIWYG" AutoGPT ships

275 lines. Per-slug: Title input, optional hero media block
(`ImageCropUploader` for the image + a plain file-upload for an optional
MP4 demo video that overlaps into the hero), optional CTA text pair, and
a body field that is either:
- `contentMode="rich"` → `BlogPostEditor` (the TipTap editor, reused
  verbatim — the same component blog posts use)
- `contentMode="plain"` → a 2-row `<textarea>` (used for the three
  hero-only subtitle rows, deliberately *not* rich, so a stray `<p>`
  can't break into `PageHero`'s subtitle markup)

**There is no drag-and-drop block builder anywhere in
`content-management/`.** Rows/columns/blocks, themes, saved blocks,
Source Code toggle, and device-width preview all live in a *different*
admin feature — `admin/mailer/templates/components/builder/` — built for
email templates, not pages.

### A6. `ImageCropUploader.tsx` — hero image tool

Hand-rolled canvas cropper: fixed 16:9 crop stage, drag-to-reposition,
slider-to-zoom (1x–3x), exports at 1600×900, plus an opacity slider whose
preview is calibrated to match `PageHero`'s actual dark-gradient overlay
exactly (the component's own doc comment documents a prior bug where the
preview effect didn't match the live effect). Nothing like this exists in
Vantly — hero image upload has no UI at all currently (see A9 / Part C).

### A7. `BlogPostEditor.tsx` — the shared rich-text engine

TipTap: Heading2/3/4, Paragraph, a **6-option font-size dropdown**
(custom `FontSizeExtension`, piggybacking a `fontSize` attribute onto
`textStyle`), Bold/Italic/**real `<u>` Underline**, Bullet/Ordered list,
**Blockquote**, Link, and **inline resizable images** (custom
`ResizableImageExtension` — insert an image *into the paragraph flow*,
then step its width 25/50/75/100%/original via toolbar buttons, not a
drag handle).

### A8. `PageHero.tsx` — how hero fields actually render

Shared component for Home/Products/Pricing/Blog/Docs: `imageUrl` (falls
back to a default brand illustration when null), a dark gradient overlay
whose strength is `overlayOpacity` (0–100, matches `heroOverlayOpacity`
1:1), `videoUrl` (renders a demo-video card overlapping ~18% into the
hero's bottom edge), `title`, `subtitle`, optional `breadcrumb`.

### A9. Public pages that actually read these fields

- `privacy-policy/page.tsx`, `terms-of-use/page.tsx`, `contact-us/page.tsx`
  — plain page shell + `{page.title}` as the real `<h1>` + sanitized
  `contentHtml` via `dangerouslySetInnerHTML`. `force-dynamic` so the DB
  is always read fresh.
- Home / 4 Product pages / Pricing / Blog / Docs — render through
  `PageHero`, so `heroImageUrl`, `heroVideoUrl`, `heroOverlayOpacity`,
  `ctaPrimaryText`, `ctaSecondaryText` are all live, all rendered.
- `/blog` listing reads `BlogPost` rows with `status: PUBLISHED`;
  `/blog/[slug]` renders one post's full `contentHtml`.

---

## Part B — Vantly's actual Content Management surface (current, live)

Source: `apps/web/lib/content/`, `apps/web/app/api/admin/content/`,
`apps/web/app/(app-dark)/dashboard/admin/content/page.tsx`.

### B1. Four fixed slugs, not nine

`lib/content/get-page.ts`: `FIXED_SLUGS = ['pricing', 'blog', 'privacy',
'terms']`. No `home-hero`, no `contact-us`, no `docs-hero`, no product
slugs, no per-post blog table.

### B2. `static_pages` schema — the part that *does* mirror AutoGPT

`supabase/migrations/20260904190000_static_pages.sql`: `slug, title,
content_html, hero_image_url, hero_video_url, hero_overlay_opacity
(default 45), cta_primary_text, cta_secondary_text, updated_by`. This is
a faithful 1:1 field-level port of AutoGPT's `StaticPage` model (done in
an earlier phase of this project, before this session's task). No
`BlogPost`-equivalent table exists anywhere in the schema.

### B3. The admin UI — `admin/content/page.tsx`, current state

Per the `SLUGS` table in that file:

| Slug | Label | `hasBody` | Body editor shown? |
|---|---|---|---|
| `pricing` | Pricing hero | false | No — title only |
| `blog` | Blog hero | false | No — title only |
| `privacy` | Privacy Policy | true | **Yes — the new drag-and-drop builder** |
| `terms` | Terms of Use | true | **Yes — the new drag-and-drop builder** |

**Only 2 of the 4 tabs have a body editor at all**, and the new
drag-and-drop builder this session built only ever renders on those 2.
Pricing and Blog get a plain title `<input>` and nothing else — the
builder work has zero effect on those two tabs.

There is also a `hasHero: boolean` field declared on every row of the
`SLUGS` array (line 23) — **it is always `false` and is never read
anywhere else in the file.** Dead code; hero-image/video upload UI does
not exist for any slug, even though the database columns for it exist
(B2) and the PUT route accepts them (B4).

CTA fields (`cta_primary_text`/`cta_secondary_text`) *are* exposed, but
only for the two `hasBody: false` slugs (pricing, blog) — i.e. exactly
the two pages whose public `page.tsx` files never read those fields at
all (see Part C). So the only fields Vantly's admin UI lets you set for
Pricing/Blog are two CTA strings that are saved successfully and then
never displayed anywhere.

### B4. API routes — accept more than the UI exposes

`api/admin/content/[slug]/route.ts` PUT accepts and stores
`hero_image_url`, `hero_video_url`, `hero_overlay_opacity`,
`cta_primary_text`, `cta_secondary_text` unconditionally — the backend is
already AutoGPT-equivalent. The gap is entirely in the admin UI (B3) and
the public pages (Part C) not using what the backend already supports.

---

## Part C — Live page → field usage map (ground truth, read from current source)

| Public page | Reads `title`? | Reads `content_html`? | Reads hero fields? | Reads CTA fields? |
|---|---|---|---|---|
| `app/pricing/page.tsx` | Yes (`page?.title \|\| 'Simple, transparent pricing'`) | No | No | No |
| `app/blog/page.tsx` | Yes (same pattern) | No | No | No |
| `app/privacy/page.tsx` | **No — H1 is the hardcoded literal string `"Privacy Policy"`** | Yes, via `renderContentVars` | No | No |
| `app/terms/page.tsx` | **No — H1 is the hardcoded literal string `"Terms of Use"`** | Yes, via `renderContentVars` | No | No |

Two concrete, confirmed-live bugs this surfaces (pre-existing, not
introduced this session, but directly relevant to "how content actually
reflects on pages" — exactly what was asked):

1. **The Title field for Privacy and Terms is dead.** An admin can type a
   new title, save it successfully, see it reflected in the admin list —
   and it will never appear on the public page. The `<h1>` is hardcoded
   in `privacy/page.tsx` / `terms/page.tsx`, not `{page.title}`.
2. **`hero_image_url`, `hero_video_url`, `hero_overlay_opacity`,
   `cta_primary_text`, `cta_secondary_text` are rendered by zero of the
   four public pages**, for all four slugs. They exist in the schema,
   the API accepts them, and (for pricing/blog) the admin UI even lets
   you type CTA text in — all of it is currently inert.

Net effect: **the drag-and-drop builder built this session is the only
part of Content Management that actually changes what a visitor sees**
(via `content_html` on `/privacy` and `/terms`), and even there, the
`{{site_url}}`/`{{support_contact}}` substitution and the sanitizer are
the same code path as before — the builder just produces the HTML that
flows through that already-working pipe.

---

## Part D — Itemized deviations

### D1. Scope gaps — AutoGPT capabilities not built at all this session

1. No blog CMS (no `BlogPost` model, no list/create/edit/delete UI, no
   draft/published/archived status, no excerpt/SEO description/cover
   image, no `/blog/[slug]` detail page backed by real data).
2. No Home-hero tab (background image + opacity + rich headline/tagline).
3. No Contact-Us tab/page.
4. No Pricing-Hero / Blog-Hero / Docs-Hero *media* editing (Vantly's
   pricing/blog tabs only ever expose a plain title — no hero image,
   video, or opacity control, unlike AutoGPT's hero-only rows which do).
5. No Product-page management (structural — Vantly has no `/products/*`
   routes to manage; noted, not counted against the port).
6. No `ImageCropUploader`-equivalent (drag-to-reposition, zoom slider,
   fixed-aspect export, overlay-matched opacity preview) anywhere.
7. Hero image/video upload has **no UI at all**, for any slug, despite
   full schema + API support (B3/B4).

### D2. Pre-existing bugs this audit surfaces (not introduced this session, but directly on-topic)

8. Privacy/Terms page `<h1>` is hardcoded, ignoring the admin-editable
   `title` field entirely (Part C, item 1).
9. `hasHero` field in `admin/content/page.tsx` is declared, always
   `false`, and never read — dead code.
10. Pricing/Blog admin tabs expose CTA text fields that no public page
    ever renders — write-only, dead data.
11. `hero_overlay_opacity`/`hero_image_url`/`hero_video_url` are
    stored and API-validated but rendered by nothing.
12. "Last updated: fill in when you adapt this page." on Privacy/Terms
    is a hardcoded string, not backed by any date field — AutoGPT has no
    equivalent claim either, but it's worth flagging since it reads as
    admin-controllable and isn't.

### D3. Implementation-level deviations in the part that *was* built (the drag-and-drop builder + inline text editor)

13. **Table-based layout → flexbox.** AutoGPT's Mailer builder (the
    thing actually ported) renders every block as `<table>`/`<tr>`/`<td>`
    for email-client compatibility. `sanitize-html.ts`'s `ALLOWED_TAGS`
    has no table tags, so every block was re-rendered with
    `div`/`span` + flexbox. Necessary, but not byte-for-byte.
14. **`style` allowlist widened from font-size-only to ~25 properties**
    (color, background, borders, flex layout, spacing, sizing) to let
    the builder express anything at all. AutoGPT's sanitizer for this
    content type isn't directly comparable (different language/stack,
    bleach-based), so this was a Vantly-side change with no AutoGPT
    equivalent to diff against.
15. **Underline renders as `<span style="text-decoration:underline">`
    instead of `<u>`**, because `<u>` isn't in `ALLOWED_TAGS`. Both of
    AutoGPT's own editors (`BlogPostEditor` and the Mailer
    `InlineTextEditor`) use real `<u>` unmodified — their sanitizer
    allows it. This is a workaround with no AutoGPT counterpart.
16. **No font-size control** in the builder's Text block editor.
    AutoGPT's `BlogPostEditor` has a 6-option font-size dropdown
    (`FontSizeExtension`); the Mailer's `InlineTextEditor` (what was
    actually ported for the Text block) does not — I ported the leaner
    of AutoGPT's two editors, which is a real capability drop relative
    to `BlogPostEditor` specifically, even though it's faithful to the
    Mailer source it was copied from.
17. **No inline images within text flow.** AutoGPT's `BlogPostEditor`
    lets you insert a resizable image *into a paragraph* via toolbar
    button (`ResizableImageExtension`, 25/50/75/100%/reset steps). The
    ported builder only supports images as a separate block — you
    cannot wrap text around or interleave an image inside a Text block.
18. **No inline Blockquote mark.** AutoGPT's `BlogPostEditor` toggles
    `<blockquote>` inline via toolbar. The ported Text block explicitly
    disables blockquote (`StarterKit.configure({ blockquote: false })`,
    copied from the Mailer's `InlineTextEditor` config) — quoting is
    only available as a separate Quote *block*, not an inline mark.
19. **`code`/`pre` disabled despite the sanitizer allowing them.**
    `sanitize-html.ts`'s `ALLOWED_TAGS` includes `code` and `pre`
    (inherited from the original textarea-era feature), but the new
    Text block editor disables both (`code: false, codeBlock: false`)
    because that flag was copied from the Mailer's `InlineTextEditor`
    config, which has good reason to disable them (email HTML has no use
    for `<pre>`) — that reasoning doesn't apply here and this is a
    capability the sanitizer already supported that got dropped by
    copying the wrong source config.
20. **Heading levels differ:** the ported Text block offers H1–H5;
    AutoGPT's `BlogPostEditor` offers H2–H4 only (its own page `<h1>`
    is the separate Title field, so an editor-inserted H1 would create a
    second, semantically-wrong top-level heading — Vantly's version can
    now produce that same issue and nothing in the UI warns against it).
21. **Image resize UX differs:** AutoGPT's `BlogPostEditor` steps width
    in fixed 25/50/75/100%/reset increments via toolbar buttons; the
    ported builder uses a free-drag pointer handle on the image corner
    instead (borrowed from the Mailer builder's `ImageBlockView`) — a
    different interaction model for the same underlying capability.
22. **No `contentMode="plain"` distinction.** AutoGPT explicitly renders
    hero-only subtitle rows as a plain `<textarea>` rather than the rich
    editor, specifically to avoid an admin-inserted `<p>` breaking
    `PageHero`'s subtitle markup. Vantly's Pricing/Blog tabs have no
    body field at all (Part B3), so this distinction doesn't currently
    apply — but if hero-body editing is ever added for those tabs, the
    same rich-vs-plain split from AutoGPT would need to be re-derived.

### D4. Capability added that AutoGPT's Content Management doesn't have at all

23. **Full drag-and-drop rows/columns/8 block types** (Text, Image,
    Button, Divider, Spacer, Quote, Social Icons, Stats) — this entire
    concept is absent from AutoGPT's `content-management/`. It exists
    only in AutoGPT's *Mailer Templates* feature, a different admin
    section for email, and was brought over here per our explicit scope
    discussion (you chose "WYSIWYG + full drag-drop block builder" when
    asked). Flagging it here because "make exactly same" and "add a
    capability AutoGPT's own Content Management doesn't have" are, by
    definition, not the same outcome — even though it was your chosen
    tradeoff.
24. **Theme presets** (4 color themes, one-click reapply across all
    blocks) — Mailer-only in AutoGPT, has no Content Management
    equivalent.
25. **"Saved blocks"** (localStorage-based reusable block library) —
    same: Mailer-only in AutoGPT.
26. **Source Code / Visual mode toggle** — same: Mailer-only in AutoGPT;
    `StaticPageEditor` has no raw-HTML escape hatch at all (the
    `BlogPostEditor` it embeds is always-rich).
27. **Desktop/Mobile preview-width toggle** — same: Mailer-only in
    AutoGPT.

---

## Count

- **7** scope gaps not attempted (D1)
- **5** pre-existing bugs/dead-code surfaced by this audit, not caused by this session (D2)
- **10** implementation-level deviations within the part that was built (D3)
- **5** capabilities added beyond what AutoGPT's Content Management itself has (D4)

**27 itemized deviations total** — more than the "at least 20" you
flagged. The two largest by user-visible impact are D2.8 (the dead Title
field on Privacy/Terms) and D1.1 (no blog CMS at all, despite "blog"
being one of the four tabs) — both worth prioritizing over any further
polish to the builder itself.

---

## What this means for next steps

Nothing here has been changed yet — this is the audit you asked for. Worth
deciding, in rough priority order:

1. Fix D2.8 (dead title) and D2.9/10/11 (dead hero/CTA fields + dead
   `hasHero` flag) — small, high-value correctness fixes independent of
   any bigger scope decision.
2. Decide whether "blog" should become a real CMS (D1.1) — this is the
   single biggest capability gap and the one most likely to be what "blog"
   implied when you asked for Content Management parity.
3. Decide whether Home-hero / Contact-Us editing (D1.2/3) matter for this
   product, given Vantly's home hero is a bespoke animated component (a
   decision made earlier in this project, separate from this session).
4. Decide whether the D3 editor-capability deltas (font-size, inline
   images, inline blockquote, code/pre, heading levels) are worth closing
   now, given the builder already covers those needs at the block level
   for most of them.
