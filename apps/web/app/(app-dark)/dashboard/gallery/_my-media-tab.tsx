// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * My Media tab of /dashboard/gallery — a personal library of images,
 * video and audio. Each item gets a short code (e.g. brand-logo-x7) you
 * can copy and paste into any script/prompt text field elsewhere in the
 * product as a human-readable reference — the actual URL (also shown,
 * also copyable) is what a script/broll_url/image field needs today;
 * nothing server-side auto-resolves a short code out of a script yet.
 *
 * Fully editable and deletable: every item can have its name, short
 * code, category and notes edited, or be removed entirely.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, UploadCloud, Image as ImageIcon, Video, Music, X, Pencil, Check, Trash2, Copy, Search,
} from 'lucide-react';

type MediaKind = 'image' | 'video' | 'audio';
type MediaCategory = 'branding' | 'script' | 'audio_sample' | 'image' | 'video' | 'other';

interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  short_code: string;
  url: string;
  mime_type: string | null;
  size_bytes: number | null;
  category: MediaCategory | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABEL: Record<MediaCategory, string> = {
  branding: 'Branding',
  script: 'Script reference',
  audio_sample: 'Audio sample',
  image: 'Image',
  video: 'Video',
  other: 'Other',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as MediaCategory[];

function kindFromMime(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MyMediaTab() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MediaItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/dashboard/media', { credentials: 'include' });
      if (!r.ok) { setItems([]); return; }
      const j = (await r.json()) as { media?: MediaItem[] };
      setItems(j.media ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) => m.name.toLowerCase().includes(q) || m.short_code.toLowerCase().includes(q) || (m.notes ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="flex flex-col gap-6">
      <UploadCard onUploaded={load} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {items ? `${items.length} item${items.length === 1 ? '' : 's'}` : ' '}
        </p>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your media…"
            className="w-full rounded-lg py-2 pl-8 pr-3 text-[13px]"
            style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
      </div>

      {items === null ? (
        <div className="flex h-40 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl py-16 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
          <UploadCloud className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.25)' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {items.length === 0 ? 'No media yet — upload something above.' : 'No items match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((m) => (
            <MediaTile key={m.id} item={m} onOpen={() => setSelected(m)} />
          ))}
        </div>
      )}

      {selected && (
        <MediaLightbox
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setItems((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev));
            setSelected(updated);
          }}
          onDeleted={(id) => {
            setItems((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function KindIcon({ kind, className, style }: { kind: MediaKind; className?: string; style?: React.CSSProperties }) {
  if (kind === 'video') return <Video className={className} style={style} />;
  if (kind === 'audio') return <Music className={className} style={style} />;
  return <ImageIcon className={className} style={style} />;
}

function MediaTile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors hover:opacity-90"
      style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg" style={{ backgroundColor: '#0F1015' }}>
        {item.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
        ) : item.kind === 'video' ? (
          <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center"><Music className="h-6 w-6" style={{ color: 'rgba(255,255,255,0.3)' }} /></div>
        )}
        <span
          className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full backdrop-blur-md"
          style={{ backgroundColor: 'rgba(15,16,21,0.7)' }}
          aria-hidden
        >
          <KindIcon kind={item.kind} className="h-3 w-3" style={{ color: '#A78BFA' }} />
        </span>
      </div>
      <div className="px-1 pb-1">
        <p className="truncate text-[12px] font-medium" style={{ color: '#E9E9F0' }}>{item.name}</p>
        <p className="truncate font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>@{item.short_code}</p>
      </div>
    </button>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
      }}
      className="inline-flex items-center gap-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[11px]"
      style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.08)', color: copied ? '#34D399' : '#A78BFA' }}
    >
      <Copy className="h-3 w-3 shrink-0" />
      <span className="truncate">{copied ? 'copied!' : value}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

function MediaLightbox({
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: MediaItem;
  onClose: () => void;
  onSaved: (updated: MediaItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [shortCode, setShortCode] = useState(item.short_code);
  const [category, setCategory] = useState<MediaCategory | ''>(item.category ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEditing = () => {
    setName(item.name);
    setShortCode(item.short_code);
    setCategory(item.category ?? '');
    setNotes(item.notes ?? '');
    setErr(null);
    setEditing(true);
  };

  const onSave = async () => {
    if (saving) return;
    if (!name.trim()) { setErr('Name cannot be empty.'); return; }
    if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(shortCode)) {
      setErr('Short code must be lowercase letters, numbers and hyphens only.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/dashboard/media/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), short_code: shortCode, category: category || null, notes: notes.trim() || null }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        setErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        setSaving(false);
        return;
      }
      setSaving(false);
      setEditing(false);
      const updated = (data as { media?: MediaItem }).media;
      if (updated) onSaved(updated);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (deleting) return;
    if (!window.confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const resp = await fetch(`/api/dashboard/media/${encodeURIComponent(item.id)}`, { method: 'DELETE', credentials: 'include' });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg = (data as any)?.error?.message ?? `HTTP ${resp.status}`;
        setErr(typeof msg === 'string' ? msg : 'Delete failed.');
        setDeleting(false);
        return;
      }
      onDeleted(item.id);
    } catch (e) {
      setErr((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl sm:flex-row"
        style={{ backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full p-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}>
          <X className="h-4 w-4" />
        </button>
        <div className="flex w-full shrink-0 items-center justify-center sm:w-44" style={{ backgroundColor: '#0F1015', minHeight: 160 }}>
          {item.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
          ) : item.kind === 'video' ? (
            <video src={item.url} controls className="h-full w-full object-contain" />
          ) : (
            <div className="flex w-full flex-col items-center gap-3 p-4">
              <Music className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.35)' }} />
              <audio src={item.url} controls className="w-full" />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-center gap-3 p-5">
          {editing ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Short code</label>
                <input
                  type="text"
                  value={shortCode}
                  onChange={(e) => setShortCode(e.target.value.toLowerCase())}
                  maxLength={60}
                  className="rounded-lg px-3 py-2 font-mono text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as MediaCategory | '')}
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <option value="">None</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={400}
                  rows={2}
                  className="resize-none rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              {err && (
                <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{err}</div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ backgroundColor: saving ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setErr(null); }}
                  disabled={saving}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold" style={{ color: '#E9E9F0' }}>{item.name}</h2>
                  <button
                    type="button"
                    onClick={startEditing}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                </div>
                <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {CATEGORY_LABEL[item.category ?? 'other'] ?? 'Uncategorized'}
                  {item.size_bytes ? ` · ${formatSize(item.size_bytes)}` : ''}
                </p>
                {item.notes && <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{item.notes}</p>}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>short code</span>
                <CopyButton value={`@${item.short_code}`} label="Copy short code" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>url</span>
                <CopyButton value={item.url} label="Copy URL" />
              </div>

              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Paste the URL into a script, broll or image field to use this asset — the short code is a memorable label for your own reference.
              </p>

              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="mt-1 inline-flex items-center justify-center gap-1.5 self-start rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={{ backgroundColor: 'rgba(255,79,79,0.1)', border: '1px solid rgba(255,79,79,0.25)', color: '#FCA5A5' }}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </button>
              {err && (
                <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{err}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState('');
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MediaCategory | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onFile = (f: File | null) => {
    setErr(null);
    if (!f) { setFile(null); setDataUrl(''); setKind(null); return; }
    const k = kindFromMime(f.type);
    if (!k) { setErr('Unsupported file type — use an image, video or audio file.'); return; }
    if (f.size > MAX_UPLOAD_BYTES) { setErr(`File is too large — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`); return; }
    setFile(f);
    setKind(k);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(f);
  };

  const reset = () => {
    setFile(null);
    setDataUrl('');
    setKind(null);
    setName('');
    setCategory('');
    setNotes('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !dataUrl || !kind || submitting) return;
    if (!name.trim()) { setErr('Give it a name.'); return; }
    setErr(null);
    setSubmitting(true);
    try {
      const resp = await fetch('/api/dashboard/media', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name: name.trim(), file_base64: dataUrl, category: category || undefined, notes: notes.trim() || undefined }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        setErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        setSubmitting(false);
        return;
      }
      reset();
      setSubmitting(false);
      void onUploaded();
    } catch (e2) {
      setErr((e2 as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-start"
      style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}
    >
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
        className="flex w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-6 text-center sm:w-48"
        style={{ backgroundColor: '#0F1015', border: '1px dashed rgba(255,255,255,0.18)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}
      >
        <input ref={inputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        {file && kind ? (
          <>
            {kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt="preview" style={{ maxHeight: 80, borderRadius: 6 }} />
            ) : (
              <KindIcon kind={kind} className="h-8 w-8" style={{ color: '#A78BFA' }} />
            )}
            <span style={{ color: '#34D399' }}>{file.name} — click to replace</span>
          </>
        ) : (
          <>
            <UploadCloud className="h-5 w-5" style={{ color: 'rgba(255,255,255,0.4)' }} />
            <span>drop an image, video or audio file here, or click to choose</span>
          </>
        )}
      </label>

      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Brand logo"
            maxLength={80}
            className="rounded-lg px-3 py-2 text-[13px]"
            style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Category (optional)</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MediaCategory | '')}
              className="rounded-lg px-3 py-2 text-[13px]"
              style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <option value="">None</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={!file || submitting}
            className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            style={{ backgroundColor: !file || submitting ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            Upload
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. use for intro scenes only"
            maxLength={400}
            className="rounded-lg px-3 py-2 text-[13px]"
            style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>

        {err && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{err}</div>
        )}
        <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Up to {MAX_UPLOAD_BYTES / 1024 / 1024}MB. A short code is generated automatically — edit it after upload if you want a specific one.
        </p>
      </div>
    </form>
  );
}
