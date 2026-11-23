// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { VoiceoverClipSchema, VoiceoverTimelineSchema, locateOutputTime, timelineDuration, timelineWords, quoteVoiceoverRenderCredits, quoteVoiceoverTtsCredits } from '@vantly-ugc/schema';
import {
  assColor,
  atempoChain,
  buildFinalArgs,
  buildOverlayAss,
  buildSegmentArgs,
  captionAspect,
  computeCanvas,
  zoomFilter,
} from '../lib/voiceover-ffmpeg.js';

const clip = (over: Record<string, unknown> = {}) => VoiceoverClipSchema.parse({ id: 'c', src_in: 10, src_out: 20, ...over });

describe('computeCanvas', () => {
  it('keeps a Filmora 2580x1540 capture at its own shape, capped to 1920', () => {
    expect(computeCanvas({ width: 2580, height: 1540 }, { aspect: 'source', fit: 'blur' })).toEqual({ W: 1920, H: 1146, cw: 1920, ch: 1146, cover: false });
  });
  it('fits into 9:16 with a content box for blur fill', () => {
    const c = computeCanvas({ width: 2580, height: 1540 }, { aspect: '9:16', fit: 'blur' });
    expect(c).toMatchObject({ W: 1080, H: 1920, cw: 1080, cover: false });
    expect(c.ch % 2).toBe(0);
  });
  it('cover fills the canvas', () => {
    expect(computeCanvas({ width: 1920, height: 1080 }, { aspect: '1:1', fit: 'cover' })).toEqual({ W: 1080, H: 1080, cw: 1080, ch: 1080, cover: true });
  });
});

describe('segment args', () => {
  const canvas = computeCanvas({ width: 1920, height: 1080 }, { aspect: 'source', fit: 'blur' });
  it('seeks, retimes and drops audio for silent captures', () => {
    const args = buildSegmentArgs({ srcPath: 's.mp4', outPath: 'o.mp4', clip: clip({ speed: 2 }), canvas, withAudio: false });
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '10', '-to', '20']);
    expect(args[args.indexOf('-vf') + 1]).toContain('setpts=(PTS-STARTPTS)/2');
    expect(args).toContain('-an');
    expect(args[args.indexOf('-t') + 1]).toBe('5');
  });
  it('chains atempo outside 0.5–2', () => {
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(1)).toEqual([]);
  });
  it('adds fades clamped to half the clip', () => {
    const vf = buildSegmentArgs({ srcPath: 's', outPath: 'o', clip: clip({ src_out: 11, fade_in: 3, fade_out: 3 }), canvas, withAudio: false });
    const f = vf[vf.indexOf('-vf') + 1];
    expect(f).toContain('fade=t=in:st=0:d=0.5');
    expect(f).toContain('fade=t=out:st=0.5:d=0.5');
  });
});

describe('zoomFilter', () => {
  it('is null without motion', () => {
    expect(zoomFilter(clip(), 1920, 1080)).toBeNull();
  });
  it('focus zoom keeps the focus point clamped inside the frame', () => {
    const z = zoomFilter(clip({ zoom: { mode: 'focus', scale: 2, x: 0.1, y: 0.9 } }), 1920, 1080)!;
    expect(z).toContain('zoompan=');
    expect(z).toContain("x='max(0,min(iw-iw/zoom,0.1*iw-iw/zoom/2))'");
    expect(z).toContain('s=1920x1080');
  });
});

describe('final args', () => {
  const canvas = computeCanvas({ width: 2580, height: 1540 }, { aspect: '9:16', fit: 'blur' });
  it('places voices with adelay and mixes them', () => {
    const args = buildFinalArgs({
      concatListPath: 'l.txt', canvas, fit: 'blur', total: 30, outPath: 'o.mp4',
      voices: [{ path: 'a.mp3', start: 1.5, volume: 1 }, { path: 'b.mp3', start: 10, volume: 0.8 }],
    });
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(g).toContain('adelay=1500|1500');
    expect(g).toContain('adelay=10000|10000');
    expect(g).toContain('amix=inputs=2');
    expect(g).toContain('boxblur');
    expect(args[args.indexOf('-t') + 1]).toBe('30');
  });
  it('emits silence when there is no audio at all', () => {
    const g = buildFinalArgs({ concatListPath: 'l', canvas, fit: 'black', total: 5, outPath: 'o', voices: [] });
    expect(g[g.indexOf('-filter_complex') + 1]).toContain('anullsrc');
    expect(g[g.indexOf('-filter_complex') + 1]).toContain('pad=1080:1920');
  });
});

describe('overlay ASS', () => {
  it('converts colours to ASS BGR', () => {
    expect(assColor('#1565C0')).toBe('&H00C06515');
  });
  it('animates and escapes text', () => {
    const ass = buildOverlayAss(
      [{ id: 'o', start: 1, end: 4, text: 'Step {1}\nnext', x: 0.5, y: 0.1, size: 54, color: '#FFFFFF', box: true, box_color: '#0B2E5C', animation: 'slide_up' }],
      1920, 1080,
    );
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('\\move(960,156,960,108,0,400)');
    expect(ass).toContain('Step (1)\\Nnext');
    expect(ass).toContain('0:00:01.00,0:00:04.00');
  });
  it('picks a caption layout from the frame', () => {
    expect(captionAspect(1920, 1146)).toBe('16:9');
    expect(captionAspect(1080, 1920)).toBe('9:16');
  });
});

describe('timeline math (shared with editor preview)', () => {
  const t = VoiceoverTimelineSchema.parse({
    clips: [{ id: 'a', src_in: 0, src_out: 10 }, { id: 'b', src_in: 30, src_out: 40, speed: 2 }],
    blocks: [{ id: 'v', start: 12, text: 'hi there', audio_url: 'https://r2.test/a.mp3', words: [{ word: 'hi', start: 0, end: 0.3 }, { word: 'there', start: 0.35, end: 0.8 }] }],
  });
  it('maps output time to source time across cuts and speed', () => {
    expect(timelineDuration(t)).toBe(15);
    expect(locateOutputTime(t, 4)).toMatchObject({ index: 0, srcT: 4 });
    expect(locateOutputTime(t, 12)).toMatchObject({ index: 1, srcT: 34 });
    expect(locateOutputTime(t, 16)).toBeNull();
  });
  it('places caption words on the output timeline', () => {
    expect(timelineWords(t)).toEqual([{ word: 'hi', start: 12, end: 12.3 }, { word: 'there', start: 12.35, end: 12.8 }]);
  });
  it('prices TTS by characters and renders by minute', () => {
    expect(quoteVoiceoverTtsCredits(10)).toBe(1);
    expect(quoteVoiceoverTtsCredits(2500)).toBe(50);
    expect(quoteVoiceoverRenderCredits(30)).toBe(6);
    expect(quoteVoiceoverRenderCredits(165)).toBe(18);
  });
});
