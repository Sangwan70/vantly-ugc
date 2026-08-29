// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import type { Metadata } from 'next';

import { MarketingShell, PageHero, CodeBlock } from '@/components/landing/marketing-shell';
import { CtaSection } from '@/components/landing/cta-section';

export const metadata: Metadata = {
  title: 'Skill Center — Vantly UGC',
  description: 'Every generation skill in the Vantly UGC registry — callable from your agent, CLI, or the API.',
};

const SKILLS: Array<{ slug: string; name: string; desc: string }> = [
  { slug: 'make_ugc', name: 'Vantly UGC Video', desc: 'The one tool for UGC video. Give a script and a person, image, or saved character — get back the finished vertical video.' },
  { slug: 'make_ugc_video', name: 'Make UGC Video', desc: 'End-to-end UGC video from a text description, a portrait, or an uploaded photo — auto-builds the character sheet along the way.' },
  { slug: 'make_simple_selfie', name: 'Make Simple Selfie', desc: 'A 5/10/15s vertical selfie video from a character sheet — lip-synced talking head, or a silent scene/b-roll clip.' },
  { slug: 'make_product_in_hands', name: 'Make Product In Hands', desc: 'Your character holds, wears, or shows a product — talking-head review or a silent demo, close-up or full body.' },
  { slug: 'make_broll_talking_head', name: 'Make B-roll Talking Head', desc: 'A talking-head video sized to your script, chunked into seamless takes, with optional narrated b-roll overlaid underneath.' },
  { slug: 'make_podcast', name: 'Make Podcast', desc: 'Two saved characters recording a podcast in one room — the camera cuts to whoever is speaking, each with a consistent look and voice.' },
  { slug: 'make_lip_sync', name: 'Make Lip Sync', desc: 'Bring your own audio and lip-sync it to a face or an existing clip — no text-to-speech involved.' },
  { slug: 'make_subtitles', name: 'Make Subtitles', desc: 'Burn TikTok- or Hormozi-style captions onto any video, auto-transcribed when you don’t supply one.' },
  { slug: 'make_character_sheet', name: 'Make Character Sheet', desc: 'Generate a reusable, magazine-style character sheet from a single portrait.' },
  { slug: 'make_portrait', name: 'Make Portrait', desc: 'Generate one photoreal portrait, optionally locked to a reference photo.' },
  { slug: 'make_wireframe', name: 'Make Wireframe', desc: 'A multi-panel photographic storyboard of the same character performing an action progression.' },
];

export default function SkillCenterPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Skill center"
        title="Every skill in the registry"
        lede="Each skill is one callable unit of the pipeline — reachable from your agent, the CLI, or the API, with zero per-skill integration code."
      />

      <section className="mx-auto w-full max-w-4xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {SKILLS.map((skill) => (
            <div
              key={skill.slug}
              className="rounded-2xl border px-6 py-5"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {skill.name}
              </p>
              <code className="text-xs" style={{ color: 'var(--cryptix-purple)' }}>
                {skill.slug}
              </code>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {skill.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--cryptix-text)' }}>
          Run any skill from the CLI
        </h2>
        <div className="mt-4">
          <CodeBlock label="bash">{`vantly-ugc skills list
vantly-ugc skills run make_ugc --input '{"script": "...", "person": "a young woman, warm smile"}'
vantly-ugc skills status <run_id>`}</CodeBlock>
        </div>
      </section>

      <CtaSection />
    </MarketingShell>
  );
}
