// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/actors — browse the caller's saved characters and the stock
 * actor catalog, or create a new reusable character either from a text
 * description (POST /api/dashboard/characters -> api-v2 /v2/characters) or
 * from an uploaded photo (make_character_sheet).
 *
 * "Create" reuses the existing make_character_sheet primitive (same skill
 * that powers /dashboard/skills/make_character_sheet): the worker's
 * character-sheet-gpt2 activity auto-saves every generated sheet as a
 * user_characters row, so a successful run here shows up in "My characters"
 * as soon as it finishes, and immediately becomes available in every skill's
 * saved-character picker (make_ugc, make_storybook, etc).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Search, Users, X, UploadCloud, Pencil, Check, Share2, ImagePlus, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAdminEmailIn } from '@/lib/admin-allowlist';
import { useVariables } from '@/components/variable-context';
import { CharacterShareModal, type ShareableCharacter } from './_character-share-modal';

interface SavedCharacter {
  id: string;
  /** The public char_… id (what the CLI, MCP and skills such as make_podcast accept). Null on shared rows / very old rows. */
  public_id?: string | null;
  name: string | null;
  description?: string | null;
  character_sheet_url: string | null;
  thumbnail_url: string | null;
  voice_brief?: string | null;
  preset_default?: string | null;
  signature_look?: string | null;
  created_at?: string;
  video_count?: number;
  /** True for a character an admin pushed into this user's library (see
   *  character_shares / GET /api/dashboard/characters) — not editable,
   *  not shareable/publishable again from here, but usable everywhere a
   *  saved character is. */
  shared?: boolean;
  shared_by?: string | null;
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

  // Admin-only affordances (share a character into another user's
  // library, push a character to the marketing /showcase page) — same
  // client-side detection idiom as dashboard/gallery/_generations-tab.tsx.
  // Server-side routes re-check the allowlist themselves; this is
  // UI-gating only, not the trust boundary.
  const { adminEmails } = useVariables();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setIsAdmin(isAdminEmailIn(user?.email, adminEmails));
    })();
  }, [adminEmails]);
  const [sharingCharacter, setSharingCharacter] = useState<SavedCharacter | null>(null);
  const [addingToShowcaseId, setAddingToShowcaseId] = useState<string | null>(null);

  const handleAddToShowcase = useCallback(async (c: SavedCharacter) => {
    if (addingToShowcaseId || !c.character_sheet_url) return;
    setAddingToShowcaseId(c.id);
    try {
      const resp = await fetch('/api/admin/showcase', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_url: c.character_sheet_url,
          label: c.name ?? null,
          source_run_id: null,
          kind: 'character',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = (data as any)?.detail ?? (data as any)?.error ?? `HTTP ${resp.status}`;
        window.alert(typeof msg === 'string' ? msg : 'Failed to add to showcase.');
        return;
      }
      window.alert('Added to the marketing showcase.');
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setAddingToShowcaseId(null);
    }
  }, [addingToShowcaseId]);

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
                    {c.shared ? (
                      <span
                        className="mt-0.5 inline-block truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                        style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#C4B5FD' }}
                        title={c.shared_by ? `Shared by ${c.shared_by}` : 'Shared'}
                      >
                        Shared{c.shared_by ? ` by ${c.shared_by}` : ''}
                      </span>
                    ) : typeof c.video_count === 'number' && (
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
          idValue={selectedCharacter.public_id ?? undefined}
          editable={!selectedCharacter.shared}
          characterId={selectedCharacter.id}
          editDescription={selectedCharacter.description}
          editVoiceBrief={selectedCharacter.voice_brief}
          editSignatureLook={selectedCharacter.signature_look}
          onSaved={(updated) => {
            setCharacters((prev) => (prev ? prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) : prev));
            setSelectedCharacter((prev) => (prev ? { ...prev, ...updated } : prev));
          }}
          downloadable
          isAdmin={isAdmin}
          shared={selectedCharacter.shared}
          sharedBy={selectedCharacter.shared_by}
          onShare={!selectedCharacter.shared ? () => setSharingCharacter(selectedCharacter) : undefined}
          onAddToShowcase={!selectedCharacter.shared ? () => void handleAddToShowcase(selectedCharacter) : undefined}
          addingToShowcase={addingToShowcaseId === selectedCharacter.id}
        />
      )}
      {sharingCharacter && sharingCharacter.character_sheet_url ? (
        <CharacterShareModal
          item={{
            character_id: sharingCharacter.id,
            name: sharingCharacter.name,
            character_sheet_url: sharingCharacter.character_sheet_url,
            portrait_url: null,
            thumbnail_url: sharingCharacter.thumbnail_url,
            description: sharingCharacter.description ?? null,
          } satisfies ShareableCharacter}
          onClose={() => setSharingCharacter(null)}
        />
      ) : null}
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
  idValue,
  editable,
  characterId,
  editDescription,
  editVoiceBrief,
  editSignatureLook,
  onSaved,
  downloadable,
  isAdmin,
  shared,
  sharedBy,
  onShare,
  onAddToShowcase,
  addingToShowcase,
}: {
  onClose: () => void;
  imageUrl?: string | null;
  title: string;
  subtitle?: string;
  copyValue?: string;
  copyLabel?: string;
  /** Public char_… id, shown with its own copy button when present. */
  idValue?: string;
  /** When true (only for "My characters"), shows an Edit affordance that opens a form to update name/metadata. */
  editable?: boolean;
  characterId?: string;
  editDescription?: string | null;
  editVoiceBrief?: string | null;
  editSignatureLook?: string | null;
  onSaved?: (updated: SavedCharacter) => void;
  /** Shows a "Download" button that proxies characterId's image through
   *  /api/dashboard/characters/:id/download so it saves as a real file
   *  instead of just opening in a new tab (see that route's own comment). */
  downloadable?: boolean;
  isAdmin?: boolean;
  /** True when this character was pushed here by an admin (character_shares) rather than made by this user. */
  shared?: boolean;
  sharedBy?: string | null;
  /** Admin-only "Share with users" action — omitted entirely for shared/stock entries. */
  onShare?: () => void;
  /** Admin-only "Publish to marketing showcase" action — omitted entirely for shared/stock entries. */
  onAddToShowcase?: () => void;
  addingToShowcase?: boolean;
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
                {shared && (
                  <p className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#C4B5FD' }}>
                    Shared{sharedBy ? ` by ${sharedBy}` : ''}
                  </p>
                )}
              </div>
              {(downloadable && characterId) || (isAdmin && (onShare || onAddToShowcase)) ? (
                <div className="flex flex-wrap items-center gap-2">
                  {downloadable && characterId && (
                    <a
                      href={`/api/dashboard/characters/${encodeURIComponent(characterId)}/download`}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium"
                      style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </a>
                  )}
                  {isAdmin && onShare && (
                    <button
                      type="button"
                      onClick={onShare}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium"
                      style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
                    >
                      <Share2 className="h-3.5 w-3.5" style={{ color: '#A78BFA' }} /> Share with users
                    </button>
                  )}
                  {isAdmin && onAddToShowcase && (
                    <button
                      type="button"
                      disabled={addingToShowcase}
                      onClick={onAddToShowcase}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
                      style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#E9E9F0' }}
                    >
                      {addingToShowcase ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" style={{ color: '#A78BFA' }} />}
                      Publish to showcase
                    </button>
                  )}
                </div>
              ) : null}
              {idValue && <CopyRow label="character_id (use this in podcasts, the CLI and the API)" value={idValue} />}
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

function PhotoCharacterForm({ onCreated }: { onCreated: () => void }) {
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

/** A labelled, click-to-copy value (used for the char_… id). */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ }
        }}
        className="truncate rounded-lg px-3 py-2 text-left text-[12px] font-mono"
        style={{ backgroundColor: '#0F1015', border: '1px solid rgba(255,255,255,0.08)', color: copied ? '#34D399' : '#A78BFA' }}
      >
        {copied ? 'copied!' : value}
      </button>
    </div>
  );
}

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

/** The worker's character-create stages (character-create-pipeline.js), in order, in plain words. */
const CREATE_STEPS: Array<{ key: string; title: string; hint: string }> = [
  { key: 'portrait', title: 'Drawing the portrait', hint: 'Creating the face from your description.' },
  { key: 'sheet', title: 'Building the character sheet', hint: 'The same person in several poses, so the look stays the same in every video.' },
  { key: 'persona_brief', title: 'Writing personality notes', hint: 'How they carry themselves on camera.' },
  { key: 'persist', title: 'Saving to My characters', hint: 'Almost done.' },
];

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Live progress for a character being created: a short headline plus the four steps. */
function CreateProgress({ name, status, stage, elapsed }: { name: string; status: string | null; stage: string | null; elapsed: number }) {
  const active = CREATE_STEPS.findIndex((st) => st.key === stage);
  const headline =
    active >= 0
      ? `Step ${active + 1} of ${CREATE_STEPS.length}: ${CREATE_STEPS[active].title.toLowerCase()}`
      : status === 'processing'
        ? 'Starting up...'
        : 'Request received. Waiting for a free slot...';
  return (
    <div className="flex flex-col gap-3 rounded-lg p-3" style={{ border: '1px solid rgba(167,139,250,0.3)', backgroundColor: 'rgba(167,139,250,0.06)' }} aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px]" style={{ color: '#E9E9F0' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#A78BFA' }} />
          {headline}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{formatElapsed(elapsed)}</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {CREATE_STEPS.map((st, i) => {
          const done = active > i;
          const current = active === i;
          return (
            <li key={st.key} className="flex items-start gap-2 text-[12px]" style={{ color: done ? '#34D399' : current ? '#E9E9F0' : 'rgba(255,255,255,0.35)' }}>
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? <Check className="h-3.5 w-3.5" /> : current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }} />}
              </span>
              <span>
                {st.title}
                {current && <span className="block text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{st.hint}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {elapsed > 300
          ? `${name || 'Your character'} is taking longer than usual, but it is still working. `
          : `Creating ${name || 'your character'} usually takes 1-3 minutes. `}
        You can leave this page - it keeps running and the character will appear in My characters.
      </p>
    </div>
  );
}
const POLL_MS = 3000;
const POLL_MAX_TICKS = 200; // ~10 minutes, then stop polling and tell the user to refresh

/**
 * Create a character from a text description alone (no photo). Mirrors the
 * limits of CharacterCreateSchema (packages/schema/src/v2/character.ts):
 * name 2-40 chars of letters/digits/space/_/-, description 8-400, voice 4-240.
 * Generation is asynchronous: POST returns a job id, we poll
 * /api/dashboard/job/:id until it reaches a terminal state, then show the
 * new char_… id.
 */
function DescribeCharacterForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [voiceBrief, setVoiceBrief] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  useEffect(() => {
    if (!submitting) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [submitting]);

  const n = name.trim();
  const d = description.trim();
  const v = voiceBrief.trim();
  const nameErr = n.length > 0 && (n.length < 2 || !NAME_RE.test(n))
    ? 'Name: 2-40 letters, digits, spaces, _ or -.'
    : null;
  const descErr = d.length > 0 && d.length < 8 ? 'Describe them in at least 8 characters.' : null;
  const voiceErr = v.length > 0 && v.length < 4 ? 'Voice notes need at least 4 characters (or leave empty).' : null;
  const canSubmit = !submitting && n.length >= 2 && !nameErr && d.length >= 8 && !voiceErr;

  const poll = useCallback((jobId: string) => {
    let ticks = 0;
    const tick = async () => {
      ticks += 1;
      try {
        const r = await fetch(`/api/dashboard/job/${encodeURIComponent(jobId)}`, { credentials: 'include' });
        if (r.ok) {
          const j = (await r.json()) as { status?: string; error_message?: string | null; character_id?: string | null; progress?: { stage?: string } | null };
          if (j.status) setStatus(j.status);
          if (j.progress?.stage) setStage(j.progress.stage);
          if (j.status && TERMINAL.has(j.status)) {
            setSubmitting(false);
            setStage(null);
            if (j.status === 'failed' || j.status === 'canceled' || j.status === 'cancelled') {
              setErr(j.error_message ?? 'Character generation failed.');
            } else {
              setCreatedId(j.character_id ?? null);
              setName('');
              setDescription('');
              setVoiceBrief('');
              void onCreated();
            }
            return;
          }
        }
      } catch { /* keep polling */ }
      if (ticks >= POLL_MAX_TICKS) {
        setSubmitting(false);
        setStatus(null);
        setErr('Still generating after 10 minutes. Refresh the page in a bit - the character will appear in "My characters" once it is ready.');
        return;
      }
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
  }, [onCreated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(null);
    setCreatedId(null);
    setStage(null);
    setSubmitting(true);
    setStatus('submitting');
    try {
      const body: Record<string, string> = { display_name: n, description: d };
      if (v) body.voice_brief = v;
      const resp = await fetch('/api/dashboard/characters', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, any>;
      if (!resp.ok) {
        const issue = data?.error?.issues?.[0]?.message as string | undefined;
        const msg = issue ?? data?.error?.message ?? data?.error ?? `HTTP ${resp.status}`;
        setErr(typeof msg === 'string' ? msg : JSON.stringify(data));
        setSubmitting(false);
        setStatus(null);
        return;
      }
      const jobId = data.job_id as string | undefined;
      if (!jobId) { setErr('No job id returned.'); setSubmitting(false); setStatus(null); return; }
      setStatus((data.status as string | undefined) ?? 'submitted');
      poll(jobId);
    } catch (e2) {
      setErr((e2 as Error).message);
      setSubmitting(false);
      setStatus(null);
    }
  };

  const fieldStyle = { backgroundColor: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.08)' } as const;
  const labelStyle = { color: 'rgba(255,255,255,0.5)' } as const;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-2xl p-5"
      style={{ border: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#14151F' }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Arya"
            maxLength={40}
            className="rounded-lg px-3 py-2 text-[13px]"
            style={fieldStyle}
          />
          {nameErr && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{nameErr}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>
            Voice notes (optional) - {v.length}/240
          </label>
          <input
            type="text"
            value={voiceBrief}
            onChange={(e) => setVoiceBrief(e.target.value)}
            placeholder="Warm, calm and unhurried; clear Indian English; slightly low, steady pitch"
            maxLength={240}
            className="rounded-lg px-3 py-2 text-[13px]"
            style={fieldStyle}
          />
          {voiceErr && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{voiceErr}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>
          Description (looks, age, clothing, vibe) - {d.length}/400
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="A warm, confident woman in her late 30s with shoulder-length dark hair and round tortoiseshell glasses. Deep teal blazer over a white top. Looks like a trusted teacher."
          className="resize-none rounded-lg px-3 py-2 text-[13px]"
          style={fieldStyle}
        />
        {descErr && <span className="text-[11px]" style={{ color: '#FCA5A5' }}>{descErr}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
          style={{ backgroundColor: canSubmit ? '#A78BFA' : 'rgba(167,139,250,0.4)', color: '#0F1015' }}
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Create character
        </button>
      </div>

      {submitting && !err && <CreateProgress name={n} status={status} stage={stage} elapsed={elapsed} />}

      {createdId && (
        <div className="flex flex-col gap-2 rounded-lg p-3" style={{ border: '1px solid rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.06)' }}>
          <span className="text-[12px]" style={{ color: '#34D399' }}>Character created and saved to My characters.</span>
          <CopyRow label="character_id" value={createdId} />
        </div>
      )}
      {err && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(255,79,79,0.3)', backgroundColor: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>
          {err}
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Generates a portrait and a multi-pose character sheet from your text, then saves it as a reusable character
        with a fixed look and voice. Use one saved character for a whole series so the face stays the same.
      </p>
    </form>
  );
}

/** Create-character panel: describe a character in words, or start from a photo. */
function CreateCharacterCard({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<'describe' | 'photo'>('describe');
  const tabStyle = (active: boolean) => ({
    backgroundColor: active ? 'rgba(167,139,250,0.18)' : 'transparent',
    color: active ? '#E9E9F0' : 'rgba(255,255,255,0.55)',
    border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)'}`,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMode('describe')} className="rounded-full px-3 py-1.5 text-[12px] font-medium" style={tabStyle(mode === 'describe')}>
          From a description
        </button>
        <button type="button" onClick={() => setMode('photo')} className="rounded-full px-3 py-1.5 text-[12px] font-medium" style={tabStyle(mode === 'photo')}>
          From a photo
        </button>
      </div>
      {mode === 'describe' ? <DescribeCharacterForm onCreated={onCreated} /> : <PhotoCharacterForm onCreated={onCreated} />}
    </div>
  );
}
