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
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ShieldAlert, Save, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { ContentBuilder } from '@/components/admin/content-builder/ContentBuilder';
import { HeroMediaUploader } from '@/components/admin/content-builder/HeroMediaUploader';

type Slug = 'home' | 'pricing' | 'blog' | 'docs' | 'privacy' | 'terms' | 'contact';
// hasHero: renders the plain-text subtitle field + HeroMediaUploader
// (image crop/zoom, video URL, overlay darkness). hasBody: renders the
// rich drag-drop ContentBuilder instead. The two are mutually exclusive
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
  const [editingSlug, setEditingSlug] = useState<Slug | null>(null);
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
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function openEdit(slug: Slug) {
    setEditingSlug(slug);
    setLoadingRow(true);
    setForm(blankForm());
    try {
      const r = await fetch(`/api/admin/content/${slug}`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); setEditingSlug(null); return; }
      const row: PageRow | null = j.page;
      setForm({
        title: row?.title ?? '',
        content_html: row?.content_html ?? '',
        cta_primary_text: row?.cta_primary_text ?? '',
        cta_secondary_text: row?.cta_secondary_text ?? '',
        hero_image_url: row?.hero_image_url ?? '',
        hero_video_url: row?.hero_video_url ?? '',
        hero_overlay_opacity: row?.hero_overlay_opacity ?? 45,
      });
    } finally { setLoadingRow(false); }
  }

  async function save() {
    if (!editingSlug) return;
    if (!form.title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/content/${editingSlug}`, {
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
      setEditingSlug(null);
      await load();
    } finally { setSaving(false); }
  }

  async function revertToDefault() {
    if (!editingSlug) return;
    if (!window.confirm('Revert this page back to the hardcoded default? This deletes the saved override.')) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/content/${editingSlug}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      setEditingSlug(null);
      await load();
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

  const meta = editingSlug ? SLUGS.find((s) => s.slug === editingSlug) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Content</h1>
      <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        A fixed set of pages -- no row means the page still uses its hardcoded default copy. The home hero is a bespoke animated component: setting a title/subtitle here replaces the animated headline with static text, and setting a hero image replaces the animated background.
      </p>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {pages === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {SLUGS.map(({ slug, label }) => {
              const item = pages.find((p) => p.slug === slug);
              return (
                <li key={slug} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: '#E9E9F0' }}>{label}</span>
                        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: item?.edited ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.08)', color: item?.edited ? '#34D399' : 'rgba(255,255,255,0.5)' }}>
                          {item?.edited ? 'Customized' : 'Default'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>/{slug}</div>
                    </div>
                    <button type="button" onClick={() => openEdit(slug)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      Edit
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editingSlug ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label={`Edit ${editingSlug}`}>
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setEditingSlug(null)} aria-hidden />
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Edit {meta?.label ?? editingSlug}</h2>
            {loadingRow ? (
              <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Title {meta?.hasBody ? '' : '(hero H1)'}
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
                {meta?.hasBody ? (
                  <>
                    <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Body content</label>
                    <ContentBuilder value={form.content_html} onChange={(content_html) => setForm((f) => ({ ...f, content_html }))} />
                    <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Supports {'{{site_url}}'} and {'{{support_contact}}'} placeholders (Text block &quot;Variable&quot; menu, or type them
                      directly). Sanitized again on save regardless of what the builder produces.
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
              </div>
            )}
            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" disabled={saving} onClick={revertToDefault} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.2)' }}>
                <RotateCcw className="h-3.5 w-3.5" /> Revert to default
              </button>
              <div className="flex items-center gap-2">
                <button type="button" disabled={saving} onClick={() => setEditingSlug(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
                <button type="button" disabled={saving || loadingRow} onClick={save} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
                  <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
