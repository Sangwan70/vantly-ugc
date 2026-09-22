// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Public marketing showcase — "See what Vantly UGC produces". Previously a
 * hardcoded CLIPS array; now backed by GET /api/showcase (public,
 * no-store), which reads the admin-curated `showcase_items` table (see
 * app/api/admin/showcase/route.ts and the gallery_shares migration's
 * header comment). The backend already enforces a rolling window of the
 * 10 most-recent items on every admin add, so this page just renders
 * whatever it's given, newest first, as a horizontally-scrollable strip
 * rather than the old wrapping grid — per the 2026-09-19 feature request
 * ("Let the list be scrollable as I keep adding to it. In a rolling
 * Window style (10 Videos)").
 *
 * A second, independent strip below it — "Featured Characters" — shows
 * published characters (GET /api/showcase?kind=character, backed by the
 * same showcase_items table's new `kind` column; see
 * app/(app-dark)/dashboard/actors/page.tsx's admin-only "Publish to
 * showcase" action and the 2026-09-22 character_shares_and_showcase
 * migration). Same ShowcaseStrip/ShowcaseTile components, own rolling
 * window of 10, own fetch — one section publishing has no effect on the
 * other's window.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { MarketingShell, PageHero } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';
import { PromptExamplesPreview } from '@/components/landing/prompt-examples-preview';

interface ShowcaseItem {
  id: string;
  media_url: string;
  label: string | null;
}

const VIDEO_RE = /\.(mp4|webm|mov)(\?|$|#)/i;

function ShowcaseTile({ item }: { item: ShowcaseItem }) {
  const isVideo = VIDEO_RE.test(item.media_url);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!isVideo) return;
    const el = ref.current;
    if (!el) return;
    if (visible) {
      if (!el.src) {
        el.src = item.media_url;
        el.load();
      }
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [visible, isVideo, item.media_url]);

  return (
    <div
      className="w-[220px] flex-none snap-start overflow-hidden rounded-2xl sm:w-[260px]"
      style={{ background: 'var(--cryptix-surface)' }}
    >
      {isVideo ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="none"
          className="w-full object-cover"
          style={{ aspectRatio: '9 / 16' }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.media_url}
          alt={item.label ?? ''}
          loading="lazy"
          className="w-full object-cover"
          style={{ aspectRatio: '9 / 16' }}
        />
      )}
      {item.label ? (
        <p className="truncate px-4 py-3 text-xs" style={{ color: 'var(--cryptix-text-muted)' }}>
          {item.label}
        </p>
      ) : null}
    </div>
  );
}

function ShowcaseStrip({ items }: { items: ShowcaseItem[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  function scrollBy(delta: number) {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {items.map((item) => (
          <ShowcaseTile key={item.id} item={item} />
        ))}
      </div>
      {items.length > 2 ? (
        <>
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scrollBy(-560)}
            className="absolute left-0 top-1/2 hidden -translate-x-3 -translate-y-1/2 items-center justify-center rounded-full p-2 backdrop-blur-md sm:flex"
            style={{ backgroundColor: 'rgba(15,16,21,0.7)', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scrollBy(560)}
            className="absolute right-0 top-1/2 hidden translate-x-3 -translate-y-1/2 items-center justify-center rounded-full p-2 backdrop-blur-md sm:flex"
            style={{ backgroundColor: 'rgba(15,16,21,0.7)', color: '#E9E9F0', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function useShowcaseItems(kind: 'video' | 'character') {
  const [items, setItems] = useState<ShowcaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/showcase?kind=${kind}`, { cache: 'no-store' });
        const json = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setError('Could not load this right now.');
          return;
        }
        setItems((json.items ?? []) as ShowcaseItem[]);
      } catch {
        if (!cancelled) setError('Could not load this right now.');
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  return { items, error };
}

export default function ShowcasePage() {
  const { items, error } = useShowcaseItems('video');
  const { items: characterItems, error: characterError } = useShowcaseItems('character');

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Showcase"
        title="See what Vantly UGC produces"
        lede="Real renders from the pipeline — talking-head UGC, character video, and captioned exports."
      />

      <section className="mx-auto w-full max-w-5xl px-6 pb-12">
        {error ? (
          <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>{error}</p>
        ) : items === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--cryptix-text-muted)' }} />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--cryptix-text-muted)' }}>
            New renders are added here regularly — check back soon.
          </p>
        ) : (
          <ShowcaseStrip items={items} />
        )}
      </section>

      {/* No heading/section at all while loading or empty — a publish-only
          feature shouldn't show a bare "Featured Characters" heading with
          nothing under it on a store with no published characters yet. */}
      {!characterError && characterItems && characterItems.length > 0 ? (
        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>Featured Characters</h2>
          <ShowcaseStrip items={characterItems} />
        </section>
      ) : null}

      <PromptExamplesPreview />

      <CtaSection />
    </MarketingShell>
  );
}
