// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/gallery
 *
 * Combined home for everything the user has made or brought to the
 * product: their generations, a personal media library they can upload
 * to and reference from scripts via a short code, their brand kit, and
 * a guided wizard for building a make_ugc prompt without knowing what
 * the underlying fields mean. Previously three separate concerns (a
 * standalone Gallery page, a standalone Brand Kit page, and no
 * media-library or guided-prompt page at all) — merged here as tabs so
 * there's one place to look.
 *
 * Tab state lives in the URL (?tab=generations|media|brand|prompts) so
 * it's deep-linkable and back/forward-safe; /dashboard/brand-kit now
 * redirects to ?tab=brand for anyone with the old link bookmarked.
 */

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Images, FolderOpen, Palette, Wand2 } from 'lucide-react';
import { GenerationsTab } from './_generations-tab';
import { MyMediaTab } from './_my-media-tab';
import { BrandKitTab } from './_brand-kit-tab';
import { MyPromptsTab } from './_my-prompts-tab';

type MainTab = 'generations' | 'media' | 'brand' | 'prompts';

const MAIN_TABS: { id: MainTab; label: string; icon: typeof Images }[] = [
  { id: 'generations', label: 'Generations', icon: Images },
  { id: 'media',       label: 'My Media',    icon: FolderOpen },
  { id: 'brand',       label: 'Brand Kit',   icon: Palette },
  { id: 'prompts',     label: 'My Prompts',  icon: Wand2 },
];

function isMainTab(v: string | null): v is MainTab {
  return v === 'generations' || v === 'media' || v === 'brand' || v === 'prompts';
}

export default function GalleryPage() {
  return (
    <Suspense fallback={null}>
      <GalleryPageInner />
    </Suspense>
  );
}

function GalleryPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: MainTab = isMainTab(tabParam) ? tabParam : 'generations';

  const setTab = useCallback(
    (next: MainTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'generations') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const titles: Record<MainTab, { eyebrow: string; heading: string; sub: string }> = {
    generations: {
      eyebrow: 'Gallery',
      heading: 'All generations',
      sub: 'Every output you’ve generated — videos and images — newest first.',
    },
    media: {
      eyebrow: 'Gallery',
      heading: 'My Media',
      sub: 'Images, video and audio you upload — reuse them anywhere a script or prompt takes free text.',
    },
    brand: {
      eyebrow: 'Gallery',
      heading: 'Your brand',
      sub: 'What we pulled from your site. Used everywhere the agents need brand context.',
    },
    prompts: {
      eyebrow: 'Gallery',
      heading: 'My Prompts',
      sub: 'Describe what you want in plain language — we’ll turn it into a ready-to-run prompt, and you can still edit every field before generating.',
    },
  };
  const t = titles[tab];

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {t.eyebrow}
        </p>
        <h1
          className="font-normal"
          style={{ color: '#E9E9F0', fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}
        >
          {t.heading}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {t.sub}
        </p>
      </div>

      <div
        className="mt-6 inline-flex items-center gap-1 rounded-full p-1"
        role="tablist"
        aria-label="Gallery sections"
        style={{ backgroundColor: '#15161D', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {MAIN_TABS.map((mt) => {
          const active = mt.id === tab;
          return (
            <button
              key={mt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(mt.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: active ? '#A78BFA' : 'transparent',
                color: active ? '#0F1015' : 'rgba(255,255,255,0.62)',
                fontWeight: active ? 600 : 500,
              }}
            >
              <mt.icon className="h-3.5 w-3.5" />
              {mt.label}
            </button>
          );
        })}
      </div>

      <div className="mt-10">
        {tab === 'generations' ? <GenerationsTab />
          : tab === 'media' ? <MyMediaTab />
          : tab === 'brand' ? <BrandKitTab />
          : <MyPromptsTab />}
      </div>
    </div>
  );
}
