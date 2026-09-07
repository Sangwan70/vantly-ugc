// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/admin/blog -- full CRUD for real blog posts (public.blog_posts),
 * replacing the hardcoded 3-entry POSTS array that used to live in
 * apps/web/app/blog/page.tsx. Separate from /dashboard/admin/content's
 * "Blog hero" row: that row still controls the /blog listing page's own
 * title/subtitle/hero-image/CTA; this page manages the posts themselves --
 * same split AutoGPT keeps between its "Blog Hero" content-management tab
 * and its separate Blog CMS.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, ShieldAlert, Save, Plus, Trash2, ImagePlus, X, Sparkles, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { WysiwygEditor } from '@/components/admin/content-builder/WysiwygEditor';

type Status = 'draft' | 'published' | 'archived';

interface PostListItem {
  id: string;
  slug: string;
  title: string;
  status: Status;
  published_at: string | null;
  updated_at: string;
}

interface PostRow extends PostListItem {
  excerpt: string;
  cover_image_url: string | null;
  content_html: string;
  seo_description: string | null;
  created_at: string;
}

interface GalleryPickItem {
  id: string;
  run_id: string;
  source: 'legacy' | 'vnext_primitive' | 'vnext_skill';
  primitive: string | null;
  status: string;
  created_at: string;
  media_url: string | null;
  thumbnail_url: string | null;
  prompt: string | null;
}

const CARD = { backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' } as const;
const INPUT = { background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' } as const;
const MAX_IMAGE_SIZE_MB = 8;
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

const STATUS_BADGE: Record<Status, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.6)', label: 'Draft' },
  published: { bg: 'rgba(52,211,153,0.12)', fg: '#34D399', label: 'Published' },
  archived: { bg: 'rgba(248,113,113,0.12)', fg: '#FCA5A5', label: 'Archived' },
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

interface Form {
  title: string;
  slug: string;
  excerpt: string;
  cover_image_url: string;
  content_html: string;
  status: Status;
  seo_description: string;
}

function blankForm(): Form {
  return { title: '', slug: '', excerpt: '', cover_image_url: '', content_html: '', status: 'draft', seo_description: '' };
}

async function uploadCoverImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/admin/content/media', { method: 'POST', credentials: 'include', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`);
  return j.url as string;
}

export default function AdminBlogPage() {
  const { adminEmails } = useVariables();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [posts, setPosts] = useState<PostListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(blankForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [loadingRow, setLoadingRow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PostListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [genPickerOpen, setGenPickerOpen] = useState(false);
  const [genQuery, setGenQuery] = useState('');
  const [genItems, setGenItems] = useState<GalleryPickItem[] | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
      setAuthChecked(true);
    })();
  }, [adminEmails]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/blog', { credentials: 'include' });
      if (r.status === 403) { setError('Not authorized.'); setPosts([]); return; }
      if (!r.ok) { setError(`blog ${r.status}`); setPosts([]); return; }
      const j = await r.json();
      setPosts(j.posts ?? []);
    } catch (e) { setError((e as Error).message); setPosts([]); }
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  // AJAX search against the merged gallery feed (legacy + vNext), debounced
  // so it doesn't fire a request per keystroke.
  useEffect(() => {
    if (!genPickerOpen) return;
    let cancelled = false;
    setGenLoading(true);
    setGenError(null);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '24' });
        if (genQuery.trim()) params.set('q', genQuery.trim());
        const r = await fetch(`/api/v1/me/gallery?${params.toString()}`, { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setGenError(j?.error?.message ?? `Failed (${r.status})`); setGenItems([]); return; }
        setGenItems(j.items ?? []);
      } catch (e) {
        if (!cancelled) { setGenError((e as Error).message); setGenItems([]); }
      } finally {
        if (!cancelled) setGenLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [genPickerOpen, genQuery]);

  function openGenPicker() {
    setGenQuery('');
    setGenItems(null);
    setGenError(null);
    setGenPickerOpen(true);
  }

  async function selectGeneration(item: GalleryPickItem) {
    setDrafting(item.run_id);
    setGenError(null);
    try {
      const r = await fetch('/api/v1/assist/draft-blog-post', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source, run_id: item.run_id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setGenError(j?.error?.message ?? `Failed (${r.status})`); return; }
      const title: string = j.title ?? '';
      setForm((f) => ({
        ...f,
        title: title || f.title,
        slug: slugTouched || !title ? f.slug : slugify(title),
        excerpt: j.excerpt ?? f.excerpt,
        content_html: j.content_html ?? f.content_html,
      }));
      setGenPickerOpen(false);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setDrafting(null);
    }
  }

  function openNew() {
    setEditingId('new');
    setForm(blankForm());
    setSlugTouched(false);
  }

  async function openEdit(id: string) {
    setEditingId(id);
    setLoadingRow(true);
    setForm(blankForm());
    setSlugTouched(true);
    try {
      const r = await fetch(`/api/admin/blog/${id}`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); setEditingId(null); return; }
      const row: PostRow = j.post;
      setForm({
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt ?? '',
        cover_image_url: row.cover_image_url ?? '',
        content_html: row.content_html ?? '',
        status: row.status,
        seo_description: row.seo_description ?? '',
      });
    } finally { setLoadingRow(false); }
  }

  function onTitleChange(title: string) {
    setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
  }

  async function onCoverFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      alert(`Max upload size is ${MAX_IMAGE_SIZE_MB}MB.`);
      return;
    }
    setUploadingCover(true);
    try {
      const url = await uploadCoverImage(file);
      setForm((f) => ({ ...f, cover_image_url: url }));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function save() {
    if (!editingId) return;
    if (!form.title.trim()) { alert('Title is required'); return; }
    setSaving(true);
    try {
      const isNew = editingId === 'new';
      const r = await fetch(isNew ? '/api/admin/blog' : `/api/admin/blog/${editingId}`, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          slug: form.slug.trim(),
          excerpt: form.excerpt.trim(),
          cover_image_url: form.cover_image_url.trim() || undefined,
          content_html: form.content_html,
          status: form.status,
          seo_description: form.seo_description.trim() || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Failed: ${j.error ?? r.status}`); return; }
      setEditingId(null);
      await load();
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/blog/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Failed: ${j.error ?? r.status}`); return; }
      setDeleteTarget(null);
      await load();
    } finally { setDeleting(false); }
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

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Internal</p>
          <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Blog Posts</h1>
          <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Real, admin-authored posts shown on the public /blog page. Only Published posts are visible there. The
            /blog page&apos;s own hero title/subtitle/image live under Content -&gt; Blog hero.
          </p>
        </div>
        <button type="button" onClick={openNew} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
          <Plus className="h-3.5 w-3.5" /> New post
        </button>
      </div>

      {error ? <p className="mt-4 text-sm" style={{ color: '#F87171' }}>{error}</p> : null}

      {posts === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
      ) : posts.length === 0 ? (
        <div className="mt-6 rounded-2xl px-4 py-8 text-center text-[13px]" style={{ ...CARD, color: 'rgba(255,255,255,0.4)' }}>
          No posts yet. Create one to replace the placeholder posts on /blog.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl" style={CARD}>
          <ul>
            {posts.map((post) => {
              const badge = STATUS_BADGE[post.status];
              return (
                <li key={post.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium" style={{ color: '#E9E9F0' }}>{post.title}</span>
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: badge.bg, color: badge.fg }}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>/blog/{post.slug}</div>
                    </div>
                    <button type="button" onClick={() => openEdit(post.id)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(post)} className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.2)' }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editingId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Edit post">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !saving && setEditingId(null)} aria-hidden />
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>{editingId === 'new' ? 'New post' : 'Edit post'}</h2>
            {loadingRow ? (
              <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Title
                  <input value={form.title} onChange={(e) => onTitleChange(e.target.value)} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Slug
                  <input
                    value={form.slug}
                    onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value })); }}
                    className="mt-1 w-full rounded-lg px-2.5 py-1.5 font-mono text-[13px]"
                    style={INPUT}
                  />
                  <span className="mt-1 block text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>/blog/{form.slug || '…'}</span>
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
                    className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]"
                    style={INPUT}
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Excerpt
                  <textarea value={form.excerpt} onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>
                <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  SEO description (optional)
                  <input value={form.seo_description} onChange={(e) => setForm((f) => ({ ...f, seo_description: e.target.value }))} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-[13px]" style={INPUT} />
                </label>

                <div>
                  <label className="block text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Cover image</label>
                  {form.cover_image_url ? (
                    <div className="mt-1.5 space-y-2">
                      <img src={form.cover_image_url} alt="" className="h-32 w-full max-w-md rounded-lg object-cover" />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <ImagePlus className="h-3.5 w-3.5" /> Replace
                        </button>
                        <button type="button" onClick={() => setForm((f) => ({ ...f, cover_image_url: '' }))} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5', border: '1px solid rgba(248,113,113,0.2)' }}>
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" disabled={uploadingCover} onClick={() => fileInputRef.current?.click()} className="mt-1.5 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {uploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Upload cover image
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={onCoverFileSelected} className="hidden" />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="text-[12px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Body content</label>
                  <button
                    type="button"
                    onClick={openGenPicker}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px]"
                    style={{ background: 'rgba(167,139,250,0.12)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.3)' }}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Generate from generated content
                  </button>
                </div>
                <WysiwygEditor value={form.content_html} onChange={(content_html) => setForm((f) => ({ ...f, content_html }))} />
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setEditingId(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={saving || loadingRow} onClick={save} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#A78BFA', color: '#191A22' }}>
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {genPickerOpen ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Pick a generation">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => drafting === null && setGenPickerOpen(false)} aria-hidden />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl p-5" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Generate from generated content</h2>
              <button type="button" onClick={() => setGenPickerOpen(false)} className="rounded-lg p-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Pick one of your generated videos or images. Its prompt, skill, and story details will be used to draft a
              ~500-word post below &mdash; review and edit before saving.
            </p>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
              <input
                autoFocus
                value={genQuery}
                onChange={(e) => setGenQuery(e.target.value)}
                placeholder="Search your generations..."
                className="w-full rounded-lg py-1.5 pl-8 pr-2.5 text-[13px]"
                style={INPUT}
              />
            </div>
            {genError ? <p className="mt-2 text-[12px]" style={{ color: '#F87171' }}>{genError}</p> : null}
            <div className="mt-3 flex-1 overflow-y-auto">
              {genLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} /></div>
              ) : !genItems || genItems.length === 0 ? (
                <div className="rounded-xl px-4 py-8 text-center text-[13px]" style={{ ...CARD, color: 'rgba(255,255,255,0.4)' }}>
                  {genQuery.trim() ? 'No generations match that search.' : 'No generations yet.'}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {genItems.map((item) => {
                    const isDrafting = drafting === item.run_id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={drafting !== null}
                          onClick={() => selectGeneration(item)}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left disabled:opacity-50"
                          style={CARD}
                        >
                          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg" style={{ background: '#0F1015' }}>
                            {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium" style={{ color: '#E9E9F0' }}>
                              {item.prompt || item.primitive || 'Untitled generation'}
                            </div>
                            <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                              {item.primitive ?? item.source} &middot; {new Date(item.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          {isDrafting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: '#A78BFA' }} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Delete post">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !deleting && setDeleteTarget(null)} aria-hidden />
          <div className="relative w-full max-w-sm rounded-3xl p-6" style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#E9E9F0' }}>Delete &quot;{deleteTarget.title}&quot;?</h2>
            <p className="mt-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>This permanently removes the post. It cannot be undone.</p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: '#1B1C2A', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
              <button type="button" disabled={deleting} onClick={confirmDelete} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium" style={{ background: '#F87171', color: '#191A22' }}>
                <Trash2 className="h-3.5 w-3.5" /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
