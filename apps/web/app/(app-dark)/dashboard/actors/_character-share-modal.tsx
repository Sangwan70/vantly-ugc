// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Admin-only "Share with users" popup for a single character — search by
 * email/name, bulk-select recipients, push a snapshot of the character
 * straight into their own character libraries
 * (POST /api/admin/characters/share). Reuses gallery's existing
 * /api/admin/gallery/search-users lookup as-is (it's a generic
 * admin-user-search endpoint, nothing gallery-specific in its logic) so
 * this doesn't duplicate that pagination/search code. See
 * app/api/admin/characters/share/route.ts and the character_shares
 * migration for why this is admin-only and denormalized — mirrors
 * dashboard/gallery/_share-modal.tsx exactly, just pointed at characters.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Check, X } from 'lucide-react';

export interface ShareableCharacter {
  character_id: string;
  name: string | null;
  character_sheet_url: string;
  portrait_url: string | null;
  thumbnail_url: string | null;
  description: string | null;
}

interface UserHit {
  id: string;
  email: string;
  display_name: string | null;
}

export function CharacterShareModal({ item, onClose }: { item: ShareableCharacter; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, UserHit>>(new Map());
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await fetch(`/api/admin/gallery/search-users?q=${encodeURIComponent(query.trim())}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await resp.json().catch(() => ({}));
        setResults(resp.ok ? (json.users ?? []) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query]);

  function toggle(u: UserHit) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u);
      return next;
    });
  }

  async function handleSend() {
    if (selected.size === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch('/api/admin/characters/share', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, user_ids: Array.from(selected.keys()) }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json?.detail ?? json?.error ?? `HTTP ${resp.status}`);
        return;
      }
      setDone(json.shared ?? selected.size);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-5"
        style={{ backgroundColor: '#191A22', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: '#E9E9F0' }}>Share character with users</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {done !== null ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(52,211,153,0.15)' }}
            >
              <Check className="h-5 w-5" style={{ color: '#34D399' }} />
            </span>
            <p className="text-sm" style={{ color: '#E9E9F0' }}>
              Shared with {done} {done === 1 ? 'user' : 'users'}.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-full px-4 py-1.5 text-xs font-medium"
              style={{ backgroundColor: '#A78BFA', color: '#0F1015' }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div
              className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ backgroundColor: '#15161D', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Search className="h-3.5 w-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by email or name…"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: '#E9E9F0' }}
              />
              {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} /> : null}
            </div>

            {selected.size > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Array.from(selected.values()).map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]"
                    style={{ backgroundColor: 'rgba(167,139,250,0.15)', color: '#C4B5FD' }}
                  >
                    {u.display_name || u.email}
                    <button type="button" onClick={() => toggle(u)} aria-label={`Remove ${u.email}`}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="max-h-56 overflow-y-auto rounded-xl" style={{ border: results.length ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
              {results.map((u) => {
                const checked = selected.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors"
                    style={{ backgroundColor: checked ? 'rgba(167,139,250,0.1)' : 'transparent', color: '#E9E9F0' }}
                  >
                    <span className="flex flex-col">
                      <span>{u.display_name || u.email}</span>
                      {u.display_name ? (
                        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{u.email}</span>
                      ) : null}
                    </span>
                    <span
                      className="flex h-4.5 w-4.5 items-center justify-center rounded"
                      style={{
                        border: `1px solid ${checked ? '#A78BFA' : 'rgba(255,255,255,0.25)'}`,
                        backgroundColor: checked ? '#A78BFA' : 'transparent',
                      }}
                    >
                      {checked ? <Check className="h-3 w-3" style={{ color: '#0F1015' }} /> : null}
                    </span>
                  </button>
                );
              })}
              {query.trim().length >= 2 && !searching && results.length === 0 ? (
                <p className="px-3 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>No matching users.</p>
              ) : null}
            </div>

            {error ? (
              <p className="mt-3 text-xs" style={{ color: '#FCA5A5' }}>{error}</p>
            ) : null}

            <button
              type="button"
              disabled={selected.size === 0 || sending}
              onClick={handleSend}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#A78BFA', color: '#0F1015' }}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Share with {selected.size || ''} {selected.size === 1 ? 'user' : selected.size > 1 ? 'users' : 'selected users'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
