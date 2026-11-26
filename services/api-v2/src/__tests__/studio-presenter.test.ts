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
