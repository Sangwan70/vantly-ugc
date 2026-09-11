// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/social — connect TikTok / Instagram / X and publish generated
 * videos to them (via Vantly, server-side). Connecting a channel finishes on
 * vantly.social in a new tab (Vantly's connect flow doesn't support a custom
 * redirect back into vantly-ugc-app), so this page also offers a manual
 * "Refresh channels" action for after the user returns. Requires the user to
 * have already connected an account on /integrations/vantly (OAuth or a
 * pasted API key) — see vantly_not_connected handling below.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Trash2, Send, Check, RefreshCw, Link2, X as XIcon, AlertCircle, ExternalLink } from 'lucide-react';
import { NetworkLogo, PoweredByVantly } from '@/components/brand-icons';
import { createClient } from '@/lib/supabase/client';

interface Provider { name: string; identifier: string; toolTip?: string }
interface Channel { id: string; name: string; provider: string; profile?: string | null }
interface GalleryVideo {
  id: string;
  run_id: string;
  source: string;
  media_url: string;
  thumbnail_url: string | null;
  created_at: string;
  primitive: string | null;
  prompt: string | null;
  title: string | null;
}

// One row per (video, channel) publish attempt for the currently-selected
// video — seeded from POST /publish's `results`, then kept live via a
// Supabase realtime subscription on vantly_publications filtered to this
// video's run_id (mirrors the pattern in
// apps/web/app/(dashboard)/integrations/vantly/page.tsx).
interface PublishStatus {
  publication_id: string | null;
  channel_id: string;
  status: 'pending' | 'uploaded' | 'published' | 'failed' | 'already_in_progress';
  error_message?: string | null;
  release_url?: string | null;
}

const IN_FLIGHT_STATUSES = new Set(['pending', 'uploaded']);
const RESOLVE_URL_POLL_MS = 5000;
const RESOLVE_URL_MAX_ATTEMPTS = 6;

const VIDEO_RE = /\.(mp4|webm|mov)(\?|$|#)/i;

const PRETTY: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  'instagram-standalone': 'Instagram (Standalone)',
  x: 'X',
};

export default function SocialPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // publish form
  const [videos, setVideos] = useState<GalleryVideo[] | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [manualUrl, setManualUrl] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [publishStatuses, setPublishStatuses] = useState<PublishStatus[] | null>(null);
  const resolveAttempts = useRef<Map<string, number>>(new Map());

  const loadChannels = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/social/channels', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) {
        if (j?.error === 'vantly_not_connected') { setNotConnected(true); setChannels([]); return; }
        setError(j?.detail || j?.error || `channels ${r.status}`); setChannels([]); return;
      }
      setNotConnected(false);
      setChannels(j.channels ?? []);
    } catch (e) { setError((e as Error).message); setChannels([]); }
  }, []);

  async function refreshChannels() {
    setRefreshing(true); setError(null);
    try { await loadChannels(); } finally { setRefreshing(false); }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/social/providers', { credentials: 'include' });
        const j = await r.json();
        if (r.ok) setProviders(j.providers ?? []);
      } catch { /* ignore */ }
    })();
    void loadChannels();
    (async () => {
      try {
        const r = await fetch('/api/v1/me/gallery?limit=100', { credentials: 'include' });
        if (!r.ok) { setVideos([]); return; }
        const j = (await r.json()) as { items?: Array<Record<string, unknown>> };
        const vids = (j.items ?? [])
          .filter((it) => it.status === 'succeeded' && typeof it.media_url === 'string' && VIDEO_RE.test(it.media_url as string))
          .map((it) => ({
            id: it.id as string,
            run_id: (it.run_id as string | undefined) ?? (it.id as string),
            source: (it.source as string | undefined) ?? 'legacy',
            media_url: it.media_url as string,
            thumbnail_url: (it.thumbnail_url as string | null) ?? null,
            created_at: it.created_at as string,
            primitive: (it.primitive as string | null) ?? null,
            prompt: (it.prompt as string | null) ?? null,
            title: (it.title as string | null) ?? null,
          }));
        setVideos(vids);
      } catch { setVideos([]); }
    })();
  }, [loadChannels]);

  // Picking a video from the dropdown fills the URL and, unless the user has
  // already typed their own caption, prefills one from the script/prompt it
  // was generated with — so publishing rarely means retyping the caption.
  const pickVideo = (id: string) => {
    setSelectedVideoId(id);
    setConfirming(false);
    setPublishStatuses(null);
    resolveAttempts.current.clear();
    const v = (videos ?? []).find((x) => x.id === id);
    if (!v) return;
    setVideoUrl(v.media_url);
    if (!captionTouched && v.prompt) setCaption(v.prompt);
  };

  async function connect(provider: string) {
    setBusy(provider); setError(null);
    try {
      const r = await fetch('/api/v1/social/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        if (j?.error === 'vantly_not_connected') { setNotConnected(true); return; }
        throw new Error(j?.detail || j?.error || `connect ${r.status}`);
      }
      window.open(j.url, '_blank', 'noopener,noreferrer');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function disconnect(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/v1/social/channels/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      await loadChannels();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const selectedVideo = (videos ?? []).find((x) => x.id === selectedVideoId) ?? null;
  const hasInFlightForSelected = !!publishStatuses?.some((s) => IN_FLIGHT_STATUSES.has(s.status));

  // Step 1 of 2: just validates + shows the inline confirm row. No network
  // call yet — this is what stops an accidental single click from
  // publishing anything, on top of the server-side idempotency guard.
  function requestPublish() {
    setError(null);
    const channel_ids = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!videoUrl || channel_ids.length === 0) { setError('Pick a video URL and at least one channel.'); return; }
    setConfirming(true);
  }

  function cancelPublish() { setConfirming(false); }

  // Step 2 of 2: the actual publish, only reachable via the confirm row.
  async function confirmPublish() {
    setConfirming(false);
    setError(null);
    const channel_ids = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!videoUrl || channel_ids.length === 0) { setError('Pick a video URL and at least one channel.'); return; }
    setBusy('publish');
    try {
      const r = await fetch('/api/v1/social/publish', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: videoUrl,
          channel_ids,
          caption,
          type: 'now',
          run_id: selectedVideo?.run_id,
          source: selectedVideo?.source,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || j?.error || `publish ${r.status}`);
      const results = Array.isArray(j?.results)
        ? (j.results as Array<{ channel_id: string; status: PublishStatus['status']; publication_id?: string; error?: string }>)
        : [];
      if (results.length === 0) throw new Error('Vantly accepted the request but nothing was published.');
      resolveAttempts.current.clear();
      setPublishStatuses(
        results.map((res) => ({
          publication_id: res.publication_id ?? null,
          channel_id: res.channel_id,
          status: res.status,
          error_message: res.error ?? null,
          release_url: null,
        })),
      );
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  // Live status: keep each channel's row in sync with vantly_publications as
  // the manual publish flow moves it through pending → uploaded → published
  // (or failed) — same realtime pattern as
  // apps/web/app/(dashboard)/integrations/vantly/page.tsx, scoped to just
  // this video's run_id via a server-side filter.
  useEffect(() => {
    const runId = selectedVideo?.run_id;
    if (!publishStatuses || publishStatuses.length === 0 || !runId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`vantly-publications-social-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vantly_publications', filter: `run_id=eq.${runId}` },
        (payload) => {
          const row = payload.new as {
            id: string; integration_id: string; status: string; error_message: string | null; release_url: string | null;
          };
          setPublishStatuses((prev) => {
            if (!prev) return prev;
            let matched = false;
            const next = prev.map((s) => {
              if (s.publication_id === row.id || (!s.publication_id && s.channel_id === row.integration_id)) {
                matched = true;
                return {
                  ...s,
                  publication_id: row.id,
                  status: row.status as PublishStatus['status'],
                  error_message: row.error_message,
                  release_url: row.release_url ?? s.release_url ?? null,
                };
              }
              return s;
            });
            return matched ? next : prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishStatuses !== null, selectedVideo?.run_id]);

  // Postiz's create-post response never includes a platform permalink and
  // has no lifecycle webhooks — once a channel reaches 'published', poll
  // the resolve-url endpoint a few times so a real "View post" link can
  // appear without the user needing to do anything.
  useEffect(() => {
    if (!publishStatuses) return;
    const pending = publishStatuses.filter(
      (s) =>
        s.status === 'published' &&
        s.publication_id &&
        !s.release_url &&
        (resolveAttempts.current.get(s.publication_id) ?? 0) < RESOLVE_URL_MAX_ATTEMPTS,
    );
    if (pending.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (const s of pending) {
        const id = s.publication_id!;
        resolveAttempts.current.set(id, (resolveAttempts.current.get(id) ?? 0) + 1);
        try {
          const r = await fetch(`/api/v1/social/publications/${encodeURIComponent(id)}/resolve-url`, { credentials: 'include' });
          if (!r.ok) continue;
          const j = await r.json();
          if (j?.release_url) {
            setPublishStatuses((prev) => (prev ? prev.map((x) => (x.publication_id === id ? { ...x, release_url: j.release_url } : x)) : prev));
          }
        } catch { /* try again next tick, or give up after RESOLVE_URL_MAX_ATTEMPTS */ }
      }
    }, RESOLVE_URL_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [publishStatuses]);

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Social</p>
      <h1 className="mt-1 font-normal" style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em' }}>Publish to social</h1>
      <p className="mt-1 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Connect TikTok, Instagram, and X, then publish any generated video straight to them.
      </p>
      <div className="mt-2"><PoweredByVantly /></div>

      {notConnected ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.08)', color: '#E9E9F0' }}>
          <span>Connect a Vantly account before adding channels here.</span>
          <Link href="/integrations/vantly" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: '#A78BFA', color: '#0F1015' }}>
            <Link2 className="h-3.5 w-3.5" /> Connect Vantly
          </Link>
        </div>
      ) : null}

      {error ? <div className="mt-4 rounded-2xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{error}</div> : null}

      {/* Connect */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Connect a channel</h2>
        <button type="button" onClick={refreshChannels} disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-60"
          style={{ background: '#14151F', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh channels
        </button>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Connecting opens vantly.social in a new tab to finish authorizing — once you&rsquo;re done there, come back here and hit &ldquo;Refresh channels&rdquo;.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {providers.length === 0 ? <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading…</span> :
          providers.map((p) => {
            const isConnected = (channels ?? []).some((c) => c.provider === p.identifier);
            const label = PRETTY[p.identifier] ?? p.name;
            return (
              <button key={p.identifier} type="button" onClick={() => connect(p.identifier)} disabled={isConnected || busy === p.identifier}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:cursor-default"
                style={{
                  background: isConnected ? 'rgba(52,211,153,0.10)' : '#14151F',
                  border: `1px solid ${isConnected ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  color: isConnected ? '#34D399' : '#E9E9F0',
                  opacity: busy === p.identifier ? 0.6 : 1,
                }}>
                <NetworkLogo provider={p.identifier} size={17} />
                {isConnected ? <Check className="h-4 w-4" /> : busy === p.identifier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" style={{ color: '#A78BFA' }} />}
                {isConnected ? `${label} connected` : `Connect ${label}`}
              </button>
            );
          })}
      </div>

      {/* Connected */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Connected channels</h2>
      <div className="mt-3">
        {channels === null ? <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading…</span> :
          channels.length === 0 ? <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No channels yet — connect one above.</p> :
          <div className="flex flex-col gap-2">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: '#14151F', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="inline-flex items-center gap-2.5" style={{ color: '#E9E9F0' }}>
                  <NetworkLogo provider={c.provider} size={18} />
                  {c.name} <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {PRETTY[c.provider] ?? c.provider}{c.profile ? ` · @${c.profile}` : ''}</span>
                </span>
                <button type="button" onClick={() => disconnect(c.id)} disabled={busy === c.id} className="inline-flex items-center gap-1 text-xs" style={{ color: '#FCA5A5' }}>
                  <Trash2 className="h-3.5 w-3.5" /> Disconnect
                </button>
              </div>
            ))}
          </div>}
      </div>

      {/* Publish */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>Publish a video</h2>
      <div className="mt-3 flex flex-col gap-3 rounded-2xl p-4" style={{ background: '#14151F', border: '1px solid rgba(255,255,255,0.06)' }}>
        {!manualUrl ? (
          <div className="flex flex-col gap-2">
            <select
              value={selectedVideoId}
              onChange={(e) => pickVideo(e.target.value)}
              disabled={videos === null}
              className="h-10 rounded-xl px-3 text-sm outline-none disabled:opacity-60"
              style={{ background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <option value="">
                {videos === null ? 'Loading your videos…' : videos.length === 0 ? 'No generated videos yet' : 'Choose a generated video…'}
              </option>
              {(videos ?? []).map((v) => {
                const date = new Date(v.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                const label = v.title ?? (v.prompt ? (v.prompt.length > 60 ? v.prompt.slice(0, 60) + '…' : v.prompt) : (v.primitive ?? 'video'));
                return <option key={v.id} value={v.id}>{date} · {label}</option>;
              })}
            </select>
            {selectedVideoId && videoUrl && (
              <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.06)' }}>
                {/* Deliberately smaller than a Gallery grid card (~150-280px) —
                    just enough to confirm this is the right video before publishing. */}
                <video
                  key={selectedVideoId}
                  src={videoUrl}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  style={{ width: 92, aspectRatio: '3 / 4', borderRadius: 8, objectFit: 'cover', background: '#000', flexShrink: 0 }}
                />
                <div className="min-w-0 flex-1">
                  {selectedVideo?.title ? (
                    <p className="truncate text-[13px] font-medium" style={{ color: '#E9E9F0' }}>{selectedVideo.title}</p>
                  ) : null}
                  <span className="block truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{videoUrl}</span>
                </div>
              </div>
            )}
            <button type="button" onClick={() => { setManualUrl(true); setSelectedVideoId(''); }} className="self-start text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>
              or paste a video URL instead
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Video URL (R2-hosted — from your Gallery)"
              className="h-10 rounded-xl px-3 text-sm outline-none" style={{ background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }} />
            <button type="button" onClick={() => { setManualUrl(false); setVideoUrl(''); }} className="self-start text-[11px] underline" style={{ color: 'rgba(255,255,255,0.45)' }}>
              choose from my generated videos instead
            </button>
          </div>
        )}
        <textarea value={caption} onChange={(e) => { setCaption(e.target.value); setCaptionTouched(true); }} placeholder="Caption — auto-filled from the video's script when you pick one above" rows={2}
          className="resize-none rounded-xl px-3 py-2 text-sm outline-none" style={{ background: '#0F1015', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }} />
        <div className="flex flex-wrap gap-3">
          {(channels ?? []).map((c) => (
            <label key={c.id} className="inline-flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
              <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))} />
              <NetworkLogo provider={c.provider} size={15} />
              {c.name} ({PRETTY[c.provider] ?? c.provider})
            </label>
          ))}
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)' }}>
            <span className="text-sm" style={{ color: '#E9E9F0' }}>
              Publish {selectedVideo?.title ? `"${selectedVideo.title}"` : 'this video'} to{' '}
              {Object.values(picked).filter(Boolean).length} channel{Object.values(picked).filter(Boolean).length === 1 ? '' : 's'}?
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={cancelPublish} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <XIcon className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" onClick={confirmPublish} disabled={busy === 'publish'} className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60" style={{ background: '#A78BFA', color: '#0F1015' }}>
                {busy === 'publish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirm publish
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={requestPublish}
              disabled={busy === 'publish' || hasInFlightForSelected}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: '#A78BFA', color: '#0F1015' }}
            >
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {hasInFlightForSelected ? 'Publishing…' : 'Publish now'}
            </button>
          </div>
        )}

        {/* Per-channel status — seeded immediately from the publish response,
            then kept live via the vantly_publications realtime subscription
            above as each row moves pending → uploaded → published (or
            failed), with a permalink once resolve-url finds one. */}
        {publishStatuses && publishStatuses.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: '#0F1015', border: '1px solid rgba(255,255,255,0.06)' }}>
            {publishStatuses.map((s) => {
              const c = (channels ?? []).find((ch) => ch.id === s.channel_id);
              const label = c ? `${c.name} (${PRETTY[c.provider] ?? c.provider})` : s.channel_id;
              return (
                <div key={s.channel_id} className="flex items-center gap-2.5 text-sm">
                  {c ? <NetworkLogo provider={c.provider} size={15} /> : null}
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{label}</span>
                  {s.status === 'pending' || s.status === 'uploaded' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {s.status === 'pending' ? 'Uploading…' : 'Publishing…'}
                    </span>
                  ) : s.status === 'published' ? (
                    s.release_url ? (
                      <a href={s.release_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: '#34D399' }}>
                        <Check className="h-3.5 w-3.5" /> Published <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: '#34D399' }}>
                        <Check className="h-3.5 w-3.5" /> Published
                      </span>
                    )
                  ) : s.status === 'already_in_progress' ? (
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Already publishing or recently published — skipped</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: '#FCA5A5' }} title={s.error_message ?? undefined}>
                      <AlertCircle className="h-3.5 w-3.5" /> Failed{s.error_message ? `: ${s.error_message}` : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
