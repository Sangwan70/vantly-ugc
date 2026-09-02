// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/actors — browse the caller's saved characters and the stock
 * actor catalog, or upload a new photo to create a reusable character.
 *
 * "Create" reuses the existing make_character_sheet primitive (same skill
 * that powers /dashboard/skills/make_character_sheet): the worker's
 * character-sheet-gpt2 activity auto-saves every generated sheet as a
 * user_characters row, so a successful run here shows up in "My characters"
 * as soon as it finishes, and immediately becomes available in every skill's
 * saved-character picker (make_ugc, make_storybook, etc).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Search, Users, X, UploadCloud, Pencil, Check } from 'lucide-react';

interface SavedCharacter {
  id: string;
  name: string | null;
  description?: string | null;
  character_sheet_url: string | null;
  thumbnail_url: string | null;
  voice_brief?: string | null;
  preset_default?: string | null;
  signature_look?: string | null;
  created_at?: string;
  video_count?: number;
}

interface StockActor {
  id: string;
  slug: string;
  name: string;
  portrait_url: string | null;
  gender?: string | null;
  age?: number | null;
  age_range?: string | null;
  nationality?: string | null;
  actor_type?: string | null;
  style?: string | null;
  voice_id?: string | null;
}

const TERMINAL = new Set(['succeeded', 'completed', 'success', 'failed', 'canceled', 'cancelled']);

export default function ActorsPage() {
  const [tab, setTab] = useState<'mine' | 'stock'>('mine');
  const [search, setSearch] = useState('');
  const [characters, setCharacters] = useState<SavedCharacter[] | null>(null);
  const [actors, setActors] = useState<StockActor[] | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<SavedCharacter | null>(null);
  const [selectedActor, setSelectedActor] = useState<StockActor | null>(null);

  const loadCharacters = useCallback(async () => {
    try {
      const r = await fetch('/api/dashboard/characters', { credentials: 'include' });
      if (!r.ok) { setCharacters([]); return; }
      const j = (await r.json()) as { characters?: SavedCharacter[] };
      setCharacters(j.characters ?? []);
    } catch {
      setCharacters([]);
    }
  }, []);

  const loadActors = useCallback(async () => {
    try {
      const r = await fetch('/api/actors', { credentials: 'include' });
      if (!r.ok) { setActors([]); return; }
      const j = (await r.json()) as { actors?: StockActor[] };
      setActors(j.actors ?? []);
    } catch {
      setActors([]);
    }
  }, []);

  useEffect(() => { void loadCharacters(); }, [loadCharacters]);
  useEffect(() => { void loadActors(); }, [loadActors]);

  const filteredCharacters = useMemo(() => {
    const list = characters ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  }, [characters, search]);

  const filteredActors = useMemo(() => {
    const list = actors ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q) || (a.nationality ?? '').toLowerCase().includes(q));
  }, [actors, search]);

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold" style={{ color: '#E9E9F0' }}>Actors</h1>
        <p className="max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Reuse one of your saved characters or a stock actor in any skill, or upload a photo below to create a new one.
        </p>
      </div>

      <div className="mt-6">
        <CreateCharacterCard onCreated={loadCharacters} />
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 rounded-full p-1" style={{ backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => setTab('mine')}
              className="rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors"
              style={{ backgroundColor: tab === 'mine' ? '#A78BFA' : 'transparent', color: tab === 'mine' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}
            >
              My characters {characters ? `(${characters.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setTab('stock')}
              className="rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors"
              style={{ backgroundColor: tab === 'stock' ? '#A78BFA' : 'transparent', color: tab === 'stock' ? '#0F1015' : 'rgba(255,255,255,0.6)' }}
            >
              Stock actors {actors ? `(${actors.length})` : ''}
            </button>
          </div>

          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.4)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'mine' ? 'Search your characters…' : 'Search stock actors…'}
              className="w-full rounded-lg py-2 pl-8 pr-3 text-[13px]"
              style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>
        </div>

        {tab === 'mine' ? (
          characters === null ? (
            <GridSkeleton />
          ) : filteredCharacters.length === 0 ? (
            <EmptyState label={characters.length === 0 ? 'No saved characters yet — upload a photo above to create one.' : 'No characters match your search.'} />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {filteredCharacters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCharacter(c)}
                  className="group flex flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors hover:opacity-90"
                  style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg" style={{ backgroundColor: '#0F1015' }}>
                    {(c.thumbnail_url ?? c.character_sheet_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail_url ?? c.character_sheet_url ?? ''} alt={c.name ?? 'character'} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center"><Users className="h-6 w-6" style={{ color: 'rgba(255,255,255,0.25)' }} /></div>
                    )}
                  </div>
                  <div className="px-1 pb-1">
                    <p className="truncate text-[12px] font-medium" style={{ color: '#E9E9F0' }}>{c.name ?? 'Unnamed'}</p>
                    {typeof c.video_count === 'number' && (
                      <p className="truncate text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{c.video_count} video{c.video_count === 1 ? '' : 's'}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : actors === null ? (
          <GridSkeleton />
        ) : filteredActors.length === 0 ? (
          <EmptyState label="No stock actors match your search." />
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {filteredActors.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedActor(a)}
                className="group flex flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors hover:opacity-90"
                style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg" style={{ backgroundColor: '#0F1015' }}>
                  {a.portrait_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.portrait_url} alt={a.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><Users className="h-6 w-6" style={{ color: 'rgba(255,255,255,0.25)' }} /></div>
                  )}
                </div>
                <div className="px-1 pb-1">
                  <p className="truncate text-[12px] font-medium" style={{ color: '#E9E9F0' }}>{a.name}</p>
                  <p className="truncate text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{a.nationality ?? a.actor_type ?? ''}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCharacter && (
        <DetailLightbox
          onClose={() => setSelectedCharacter(null)}
          imageUrl={selectedCharacter.thumbnail_url ?? selectedCharacter.character_sheet_url}
          title={selectedCharacter.name ?? 'Unnamed character'}
          subtitle={selectedCharacter.description ?? undefined}
          copyValue={selectedCharacter.character_sheet_url ?? undefined}
          copyLabel="character_sheet_url"
          editable
          characterId={selectedCharacter.id}
          editDescription={selectedCharacter.description}
          editVoiceBrief={selectedCharacter.voice_brief}
          editSignatureLook={selectedCharacter.signature_look}
          onSaved={(updated) => {
            setCharacters((prev) => (prev ? prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) : prev));
            setSelectedCharacter((prev) => (prev ? { ...prev, ...updated } : prev));
          }}
        />
      )}
      {selectedActor && (
        <DetailLightbox
          onClose={() => setSelectedActor(null)}
          imageUrl={selectedActor.portrait_url}
          title={selectedActor.name}
          subtitle={[selectedActor.age ? `${selectedActor.age}yo` : null, selectedActor.gender, selectedActor.nationality].filter(Boolean).join(' · ') || undefined}
          copyValue={selectedActor.portrait_url ?? undefined}
          copyLabel="portrait_url"
        />
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="flex h-40 items-center justify-center rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl py-16 text-center" style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}>
      <Users className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.25)' }} />
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</p>
    </div>
  );
}

function DetailLightbox({
  onClose,
  imageUrl,
  title,
  subtitle,
  copyValue,
  copyLabel,
  editable,
  characterId,
  editDescription,
  editVoiceBrief,
  editSignatureLook,
  onSaved,
}: {
  onClose: () => void;
  imageUrl?: string | null;
  title: string;
  subtitle?: string;
  copyValue?: string;
  copyLabel?: string;
  /** When true (only for "My characters"), shows an Edit affordance that opens a form to update name/metadata. */
  editable?: boolean;
  characterId?: string;
  editDescription?: string | null;
  editVoiceBrief?: string | null;
  editSignatureLook?: string | null;
  onSaved?: (updated: SavedCharacter) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [description, setDescription] = useState(editDescription ?? '');
  const [voiceBrief, setVoiceBrief] = useState(editVoiceBrief ?? '');
  const [signatureLook, setSignatureLook] = useState(editSignatureLook ?? '');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const startEditing = () => {
    setName(title);
    setDescription(editDescription ?? '');
    setVoiceBrief(editVoiceBrief ?? '');
    setSignatureLook(editSignatureLook ?? '');
    setSaveErr(null);
    setEditing(true);
  };

  const onSave = async () => {
    if (!characterId || saving) return;
    if (!name.trim()) { setSaveErr('Name cannot be empty.'); return; }
    setSaving(true);
    setSaveErr(null);
    try {
      const resp = await fetch(`/api/dashboard/characters/${encodeURIComponent(characterId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          voice_brief: voiceBrief.trim() || null,
          signature_look: signatureLook.trim() || null,
        }),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        setSaveErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        setSaving(false);
        return;
      }
      setSaving(false);
      setEditing(false);
      const updated = (data as { character?: SavedCharacter }).character;
      if (updated) onSaved?.(updated);
    } catch (e) {
      setSaveErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        className="relative flex w-full max-w-lg overflow-hidden rounded-2xl"
        style={{ backgroundColor: '#14151F', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full p-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}>
          <X className="h-4 w-4" />
        </button>
        <div className="w-44 shrink-0" style={{ backgroundColor: '#0F1015' }}>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center"><Users className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.25)' }} /></div>
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
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={400}
                  rows={2}
                  placeholder="Sara, 28 years old — warm, upbeat vibe"
                  className="resize-none rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Voice notes (optional)</label>
                <input
                  type="text"
                  value={voiceBrief}
                  onChange={(e) => setVoiceBrief(e.target.value)}
                  maxLength={240}
                  placeholder="e.g. warm, upbeat, mid-pitched American accent"
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Signature look (optional)</label>
                <input
                  type="text"
                  value={signatureLook}
                  onChange={(e) => setSignatureLook(e.target.value)}
                  maxLength={240}
                  placeholder="e.g. always in a denim jacket, wavy dark hair"
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              {saveErr && (
                <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
                  {saveErr}
                </div>
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
                  onClick={() => { setEditing(false); setSaveErr(null); }}
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
                  <h2 className="text-lg font-semibold" style={{ color: '#E9E9F0' }}>{title}</h2>
                  {editable && (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                </div>
                {subtitle && <p className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{subtitle}</p>}
                {editVoiceBrief && <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Voice: {editVoiceBrief}</p>}
                {editSignatureLook && <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Look: {editSignatureLook}</p>}
              </div>
              {copyValue && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{copyLabel}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(copyValue); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
                    }}
                    className="truncate rounded-lg px-3 py-2 text-left text-[11px]"
                    style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.08)', color: copied ? '#34D399' : '#A78BFA' }}
                  >
                    {copied ? 'copied!' : copyValue}
                  </button>
                </div>
              )}
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Pick this from any skill&apos;s &quot;reuse a saved character&quot; picker, or paste the URL above.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateCharacterCard({ onCreated }: { onCreated: () => void }) {
  const [dataUrl, setDataUrl] = useState('');
  const [description, setDescription] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '9:16'>('1:1');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const onFile = (file: File | null) => {
    if (!file) { setDataUrl(''); return; }
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  };

  const poll = useCallback((runId: string) => {
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/primitives/runs/${encodeURIComponent(runId)}`, { credentials: 'include' });
        if (r.ok) {
          const d = (await r.json()) as { status?: string; error?: { message?: string | null } | null };
          if (d.status) setStatus(d.status);
          if (d.status && TERMINAL.has(d.status)) {
            setSubmitting(false);
            if (d.status === 'succeeded' || d.status === 'completed' || d.status === 'success') {
              setDataUrl('');
              setDescription('');
              void onCreated();
            } else {
              setErr(d.error?.message ?? 'Character generation failed.');
            }
            return;
          }
        }
      } catch { /* keep polling */ }
      pollRef.current = setTimeout(tick, 3000);
    };
    pollRef.current = setTimeout(tick, 3000);
  }, [onCreated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataUrl || submitting) return;
    setErr(null);
    setSubmitting(true);
    setStatus('submitting');
    try {
      const body: Record<string, unknown> = { portrait_image_base64: dataUrl, aspect_ratio: aspectRatio };
      if (description.trim()) body.description = description.trim();
      const resp = await fetch('/api/v1/skills/make_character_sheet/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) {
        const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        setErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        setSubmitting(false);
        setStatus(null);
        return;
      }
      const runId = (data.run_id as string | undefined) ?? undefined;
      if (!runId) { setErr('no run id returned'); setSubmitting(false); setStatus(null); return; }
      setStatus((data.status as string | undefined) ?? 'submitted');
      poll(runId);
    } catch (e2) {
      setErr((e2 as Error).message);
      setSubmitting(false);
      setStatus(null);
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
        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        {dataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="new character preview" style={{ maxHeight: 96, borderRadius: 6 }} />
            <span style={{ color: '#34D399' }}>photo attached — click to replace</span>
          </>
        ) : (
          <>
            <UploadCloud className="h-5 w-5" style={{ color: 'rgba(255,255,255,0.4)' }} />
            <span>drop a photo here, or click to choose (PNG/JPEG)</span>
          </>
        )}
      </label>

      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Name / vibe hint (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Sara, 28 years old"
            maxLength={80}
            className="rounded-lg px-3 py-2 text-[13px]"
            style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Aspect ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as '1:1' | '9:16')}
              className="rounded-lg px-3 py-2 text-[13px]"
              style={{ backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <option value="1:1">1:1</option>
              <option value="9:16">9:16</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={!dataUrl || submitting}
            className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
            style={{ backgroundColor: !dataUrl || submitting ? 'rgba(167,139,250,0.4)' : '#A78BFA', color: '#0F1015' }}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Create character
          </button>
        </div>

        {status && !err && (
          <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {submitting ? `${status}…` : status}
          </span>
        )}
        {err && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
            {err}
          </div>
        )}
        <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Uses the make_character_sheet skill — the new stylized sheet auto-saves here as a reusable character.
        </p>
      </div>
    </form>
  );
}
