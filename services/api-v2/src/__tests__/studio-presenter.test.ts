// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { VoiceoverTimelineSchema } from '@vantly-ugc/schema';

// studio-pro imports the server's supabase client; stub it.
vi.mock('../server.js', () => ({ supabase: {} }));

const { applyTemplateToTimeline, extractTemplate } = await import('../routes/v1/studio-pro.js');

const me = 'https://cdn.example.com/studio/me.jpg';
const series = VoiceoverTimelineSchema.parse({
  clips: [{ id: 'c1', src_in: 0, src_out: 10 }],
  presenter: { photo_url: me, scene: 'a bright home office', corner: 'bl', size: 0.3, consent: true },
});

describe('presenter in series templates', () => {
  it('carries the look but never the consent', () => {
    const tpl = extractTemplate(series);
    expect(tpl.presenter?.photo_url).toBe(me);
    expect(tpl.presenter?.corner).toBe('bl');
    expect(tpl.presenter?.consent).toBe(false);
  });

  it('asks a new episode to confirm consent again', () => {
    const fresh = VoiceoverTimelineSchema.parse({ clips: [{ id: 'c1', src_in: 0, src_out: 8 }] });
    const out = applyTemplateToTimeline(fresh, extractTemplate(series));
    expect(out.presenter.photo_url).toBe(me);
    expect(out.presenter.scene).toBe('a bright home office');
    expect(out.presenter.consent).toBe(false);
  });

  it('keeps consent already given for the same photo', () => {
    const consented = VoiceoverTimelineSchema.parse({ clips: [{ id: 'c1', src_in: 0, src_out: 8 }], presenter: { photo_url: me, consent: true } });
    expect(applyTemplateToTimeline(consented, extractTemplate(series)).presenter.consent).toBe(true);
  });
});

describe('series closing clip', () => {
  const take = '2841a611-7793-4824-941e-13660d2fcad4';
  const ep2 = VoiceoverTimelineSchema.parse({
    clips: [
      { id: 'c1', src_in: 0, src_out: 20 },
      { id: 'thanks', kind: 'card', card: { title: 'Thank you', duration: 5 } },
    ],
    blocks: [
      { id: 'demo', start: 2, text: 'Demo line', audio_url: 'https://cdn.example.com/a.mp3', audio_duration: 6, take_id: 'c0b1d1c4-0000-4000-8000-000000000000' },
      { id: 'bye', start: 20.4, text: 'Thanks for watching', audio_url: 'https://cdn.example.com/bye.mp3', audio_duration: 3.5, take_id: take,
        presenter: { on: true, clip_url: 'https://cdn.example.com/bye.mp4', clip_key: 'k' } },
    ],
  });

  it('saves only the narration on the outro card, relative to it', () => {
    const tpl = extractTemplate(ep2);
    expect(tpl.outro_blocks).toHaveLength(1);
    expect(tpl.outro_blocks?.[0].start).toBeCloseTo(0.4);
    expect(tpl.outro_blocks?.[0].presenter?.clip_url).toBe('https://cdn.example.com/bye.mp4');
  });

  it("drops it onto the next episode's outro card with the same take (no new charge)", () => {
    const ep3 = VoiceoverTimelineSchema.parse({ clips: [{ id: 'c1', src_in: 0, src_out: 30 }] });
    const out = applyTemplateToTimeline(ep3, extractTemplate(ep2));
    const bye = out.blocks.find((b) => b.text === 'Thanks for watching')!;
    expect(bye.take_id).toBe(take);
    expect(bye.presenter?.clip_url).toBe('https://cdn.example.com/bye.mp4');
    expect(bye.start).toBeCloseTo(30.4);
    expect(bye.id).not.toBe('bye');
  });
});
