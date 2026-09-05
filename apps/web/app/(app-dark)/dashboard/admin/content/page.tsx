// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/content -- edit the fixed set of DB-backed marketing
 * pages (see apps/web/lib/content/get-page.ts's FIXED_SLUGS). Raw HTML +
 * live preview, matching the plan document's own verdict on skipping a
 * visual WYSIWYG builder for v1. content_html is sanitized server-side on
 * every save regardless of what's typed here -- the preview below is a
 * best-effort client-side approximation to show what will actually render,
 * not the security boundary itself.
 *
 * Horizontally tabbed (one tab per fixed page, Home open by default) --
 * previously a vertical list of rows each opening a modal dialog to edit.
 * Switching tabs re-fetches that page's row the same way the old "Edit"
 * button did; there's no separate closed state anymore, so there's always
 * exactly one page's editor showing.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Save, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { WysiwygEditor } from '@/components/admin/content-builder/WysiwygEditor';
import { HeroMediaUploader } from '@/components/admin/content-builder/HeroMediaUploader';
import {
  DEFAULT_PRIVACY_TITLE,
  DEFAULT_PRIVACY_HTML,
  DEFAULT_TERMS_TITLE,
  DEFAULT_TERMS_HTML,
} from '@/lib/content/default-static-page-content';

type Slug = 'home' | 'pricing' | 'blog' | 'docs' | 'privacy' | 'terms' | 'contact';
// hasHero: renders the plain-text subtitle field + HeroMediaUploader
// (image crop/zoom, video URL, overlay darkness). hasBody: renders the
// simple WYSIWYG editor (rich text + inline image upload/resize, with a
// Visual/Source Code toggle) instead. The two are mutually exclusive
// today (matching AutoGPT's StaticPageEditor contentMode='plain' vs
// 'rich' split) -- a hero-only page's "content_html" column stores its
// plain-text subtitle, not rich HTML; a body page's stores rich HTML.
const SLUGS: { slug: Slug; label: string; hasHero: boolean; hasBody: boolean }[] = [
  { slug: 'home', label: 'Home hero', hasHero: true, hasBody: false },
  { slug: 'pricing', label: 'Pricing hero', hasHero: true, hasBody: false },
  { slug: 'blog', label: 'Blog hero', hasHero: true, hasBody: false },
  { slug: 'docs', label: 'Docs hero', hasHero: true, hasBody: false },
  { slug: 'privacy', label: 'Privacy Policy', hasHero: false, hasBody: true },
  { slug: 'terms', label: 'Terms of Use', hasHero: false, hasBody: true },
  { slug: 'contact', label: 'Contact Us', hasHero: false, hasBody: true },
];

// The tab that's open on first load, before the admin picks anything else.
const DEFAULT_SLUG: Slug = 'home';

// Pre-fills the admin editor with the page's real hardcoded default copy
// (see app/privacy/page.tsx / app/terms/page.tsx) when no static_pages row
// exists yet, so editing starts from actual current content instead of a
// blank form. Purely a client-side form default -- saving still requires
// hitting Save like any other edit, and slugs with no entry here (or a
// row that already exists) behave exactly as before.
const DEFAULT_BODY_CONTENT: Partial<Record<Slug, { title: string; content_html: string }>> = {
  privacy: { title: DEFAULT_PRIVACY_TITLE, content_html: DEFAULT_PRIVACY_HTML },
  terms: { title: DEFAULT_TERMS_TITLE, content_html: DEFAULT_TERMS_HTML },
};

interface PageListItem { slug: Slug; title: string | null; updated_at: string | null; edited: boolean }
interface PageRow {
  slug: string; title: string; content_html: string;
  hero_image_url: string | null; hero_video_url: string | null; hero_overlay_opacity: number;
  cta_primary_text: string | null; cta_secondary_text: string | null;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;

interface Form {
  title: string;
  content_html: string;
  cta_primary_text: string;
  cta_secondary_text: string;
  hero_image_url: string;
  hero_video_url: string;
  hero_overlay_opacity: number;
}

function blankForm(): Form {
  return {
    title: '', content_html: '', cta_primary_text: '', cta_secondary_text: '',
    hero_image_url: '', hero_video_url: '', hero_overlay_opacity: 45,
  };
}

export default function AdminContentPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pages, setPages] = useState<PageListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<Slug>(DEFAULT_SLUG);
  const [form, setForm] = useState<Form>(blankForm());
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/content', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setPages([]); return; }
      if (!r.ok) { setError(`content ${r.status}`); setPages([]); return; }
      const j = await r.json();
      setPages(j.pages ?? []);
    } catch (e) { setError((e as Error).message); setPages([]); }
  }, []);

  const openTab = useCallback(async (slug: Slug) => {
    setActiveSlug(slug);
    setLoadingRow(true);
    setForm(blankForm());
    try {
      const r = await fetch(`/api/admin/content/${slug}`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      const row: PageRow | null = j.page;
      const fallback = row ? null : DEFAULT_BODY_CONTENT[slug];
      setForm({
        title: row?.title ?? fallback?.title ?? '',
        content_html: row?.content_html ?? fallback?.content_html ?? '',
        cta_primary_text: row?.cta_primary_text ?? '',
        cta_secondary_text: row?.cta_secondary_text ?? '',
        hero_image_url: row?.hero_image_url ?? '',
        hero_video_url: row?.hero_video_url ?? '',
        hero_overlay_opacity: row?.hero_overlay_opacity ?? 45,
      });
    } finally { setLoadingRow(false); }
  }, []);

  // Load the page list (for the Customized/Default badges) and open the
  // default tab's editor as soon as the admin check passes -- the Home
  // tab is showing, populated, and ready to edit without any extra click.
  useEffect(() => {
    if (!isAdmin) return;
    void load();
    void openTab(DEFAULT_SLUG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function save() {
    if (!form.title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/content/${activeSlug}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          content_html: form.content_html,
          cta_primary_text: form.cta_primary_text.trim() || undefined,
          cta_secondary_text: form.cta_secondary_text.trim() || undefined,
          hero_image_url: form.hero_image_url.trim() || undefined,
          hero_video_url: form.hero_video_url.trim() || undefined,
          hero_overlay_opacity: form.hero_overlay_opacity,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
    } finally { setSaving(false); }
  }

  async function revertToDefault() {
    if (!window.confirm('Revert this page back to the hardcoded default? This deletes the saved override.')) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/content/${activeSlug}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      await load();
      await openTab(activeSlug);
    } finally { setSaving(false); }
  }

  if (!authChecked) {
    return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-8 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8" style={{ color: '#F87171' }} />
        <h1 className="mt-3 text-lg font-semibold" style={{ color: '#E9E9F0' }}>Not authorized</h1>
      </div>
    );
  }

  const meta = SLUGS.find((s) => s.slug === activeSlug) ?? SLUGS[0];
  const activeListItem = pages?.find((p) => p.slug === activeSlug);

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Content</h1>
      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        A fixed set of pages -- no row means the page still uses its hardcoded default copy. The home hero is a bespoke animated component: setting a title/subtitle here replaces the animated headline with static text, and setting a hero image replaces the animated background.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {/* Horizontal page tabs -- click one to open it for editing below. */}
      <div className="mt-6 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }} role="tablist" aria-label="Content pages">
        {SLUGS.map(({ slug, label }) => {
          const item = pages?.find((p) => p.slug === slug);
          const active = slug === activeSlug;
          return (
            <button
              key={slug}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={saving}
              onClick={() => { if (slug !== activeSlug) void openTab(slug); }}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-[13px]"
              style={{
                color: active ? '#E9E9F0' : 'rgba(255,255,255,0.5)',
                fontWeight: active ? 600 : 500,
                borderBottom: active ? '2px solid #A78BFA' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {label}
              {item?.edited ? (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#34D399' }} aria-label="Customized" title="Customized" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        <span>/{activeSlug}</span>
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: activeListItem?.edited ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.08)', color: activeListItem?.edited ? '#34D399' : 'rgba(255,255,255,0.5)' }}>
          {activeListItem?.edited ? 'Customized' : 'Default'}
        </span>
      </div>

      <div className="mt-3 rounded-2xl p-6" style={CARD}>
        {loadingRow ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
        ) : (
          <div className="space-y-3">
            <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Title {meta.hasBody ? '' : '(hero H1)'}
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
            </label>
            {meta.hasBody ? (
              <>
                <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Body content</label>
                <WysiwygEditor value={form.content_html} onChange={(content_html) => setForm((f) => ({ ...f, content_html }))} />
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Supports {'{{site_url}}'} and {'{{support_contact}}'} placeholders (Text block &quot;Variable&quot; menu, or type them
                  directly). Sanitized again on save regardless of what the builder produces. Drag the bottom-right corner of the
                  editor to resize it.
                </p>
              </>
            ) : (
              <>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Subtitle (plain text, shown under the hero title)
                  <textarea
                    value={form.content_html}
                    onChange={(e) => setForm({ ...form, content_html: e.target.value })}
                    rows={2}
                    className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]"
                    style={INPUT}
                  />
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Primary CTA text (optional)
                  <input value={form.cta_primary_text} onChange={(e) => setForm({ ...form, cta_primary_text: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Secondary CTA text (optional)
                  <input value={form.cta_secondary_text} onChange={(e) => setForm({ ...form, cta_secondary_text: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
                <div className="pt-1">
                  <HeroMediaUploader
                    value={{
                      hero_image_url: form.hero_image_url,
                      hero_video_url: form.hero_video_url,
                      hero_overlay_opacity: form.hero_overlay_opacity,
                    }}
                    onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                  />
                </div>
              </>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" disabled={saving} onClick={revertToDefault} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.2)' }}>
                <RotateCcw className="h-3.5 w-3.5" /> Revert to default
              </button>
              <button type="button" disabled={saving || loadingRow} onClick={save} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
