// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  CaptionStyleSchema,
  CardSchema,
  EffectSchema,
  VoiceoverClipSchema,
  VoiceoverTimelineSchema,
  applySuggestions,
  autoSpaceTimelineBlocks,
  cameraAt,
  captionLines,
  clipStarts,
  locateOutputTime,
  parseNarrationScript,
  quoteVoiceoverRenderCredits,
  quoteVoiceoverTtsCredits,
  sourceToOutput,
  splitKeyframes,
  timelineDuration,
  timelineWords,
} from '@vantly-ugc/schema';
import {
  arrowPath,
  assColor,
  atempoChain,
  buildAudioNormalizeArgs,
  buildCaptionsAss,
  buildCardAss,
  buildFinalArgs,
  buildJoinArgs,
  buildOverlayAss,
  buildSegmentArgs,
  computeCanvas,
  coverChain,
  coverContentAt,
  coverViewAt,
  keyframeExpr,
  zoomFilter,
} from '../lib/voiceover-ffmpeg.js';
import { diffFrames, suggestEdits } from '../activities/voiceover-prepare.js';

const clip = (over: Record<string, unknown> = {}) => VoiceoverClipSchema.parse({ id: 'c', src_in: 10, src_out: 20, ...over });
const fg = (args: string[]) => args[args.indexOf('-filter_complex') + 1];

describe('canvas + quality', () => {
  it('keeps a Filmora 2580x1540 capture at its own shape, capped by quality', () => {
    expect(computeCanvas({ width: 2580, height: 1540 }, { aspect: 'source', fit: 'blur' })).toMatchObject({ W: 1920, H: 1146 });
    expect(computeCanvas({ width: 2580, height: 1540 }, { aspect: 'source', fit: 'blur', quality: 'draft' })).toMatchObject({ W: 1280 });
    expect(computeCanvas({ width: 2580, height: 1540 }, { aspect: 'source', fit: 'blur', quality: 'high' })).toMatchObject({ W: 2580 });
  });
  it('fits 9:16 with a content box, cover fills', () => {
    const c = computeCanvas({ width: 2580, height: 1540 }, { aspect: '9:16', fit: 'blur' });
    expect(c).toMatchObject({ W: 1080, H: 1920, cw: 1080, cover: false });
    expect(computeCanvas({ width: 1920, height: 1080 }, { aspect: '1:1', fit: 'cover' })).toMatchObject({ W: 1080, H: 1080, cover: true });
  });
  it('reports where the recording lands on the canvas', () => {
    expect(computeCanvas({ width: 1920, height: 1080 }, { aspect: 'source', fit: 'blur' }).content).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    // 16:9 recording in a 9:16 frame: centred 1080x608 box.
    expect(computeCanvas({ width: 1920, height: 1080 }, { aspect: '9:16', fit: 'blur' }).content).toEqual({ x: 0, y: 656, w: 1080, h: 608 });
    // Cover scales the frame up and crops the sides, so the rect overhangs.
    expect(computeCanvas({ width: 1920, height: 1080 }, { aspect: '1:1', fit: 'cover' }).content).toEqual({ x: -420, y: 0, w: 1920, h: 1080 });
  });
});

describe('segments', () => {
  const canvas = computeCanvas({ width: 1920, height: 1080 }, { aspect: '9:16', fit: 'blur' });
  it('seeks, retimes, composes onto the full canvas and drops audio for silent captures', () => {
    const args = buildSegmentArgs({ srcPath: 's.mp4', outPath: 'o.mp4', clip: clip({ speed: 2 }), canvas, quality: 'standard', withAudio: false });
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '10', '-to', '20']);
    expect(fg(args)).toContain('setpts=(PTS-STARTPTS)/2');
    expect(fg(args)).toContain('boxblur');
    expect(args).not.toContain('-an');
    expect(args).not.toContain('[a]');
    expect(args[args.indexOf('-t') + 1]).toBe('5');
  });
  it('supersamples 2× before zoompan except in draft', () => {
    const c = clip({ zoom: { mode: 'focus', scale: 2, x: 0.1, y: 0.9 } });
    expect(fg(buildSegmentArgs({ srcPath: 's', outPath: 'o', clip: c, canvas, quality: 'standard', withAudio: false }))).toContain(`scale=${canvas.cw * 2}:${canvas.ch * 2}`);
    expect(fg(buildSegmentArgs({ srcPath: 's', outPath: 'o', clip: c, canvas, quality: 'draft', withAudio: false }))).toContain(`scale=${canvas.cw}:${canvas.ch}`);
  });
  it('chains atempo outside 0.5–2', () => {
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(1)).toEqual([]);
  });
});

describe('camera', () => {
  it('is still without motion; focus clamps inside the frame', () => {
    expect(zoomFilter(clip(), 1920, 1080)).toBeNull();
    const z = zoomFilter(clip({ zoom: { mode: 'focus', scale: 2, x: 0.1, y: 0.9 } }), 1920, 1080)!;
    expect(z).toContain("x='max(0,min(iw-iw/zoom,(0.1)*iw-iw/zoom/2))'");
  });
  it('keyframe expression matches cameraAt at sampled times', () => {
    const kf = [
      { t: 0, zoom: 1, x: 0.5, y: 0.5, ease: 'ease_in_out' as const },
      { t: 2, zoom: 2, x: 0.2, y: 0.4, ease: 'hold' as const },
      { t: 4, zoom: 2, x: 0.2, y: 0.4, ease: 'linear' as const },
      { t: 6, zoom: 1, x: 0.5, y: 0.5, ease: 'linear' as const },
    ];
    for (const ch of ['zoom', 'x', 'y'] as const) {
      const expr = keyframeExpr(kf, ch, 'T');
      // Evaluate the ffmpeg expression with JS semantics.
      const js = expr.replace(/if\(/g, 'iff(').replace(/lt\(/g, 'ltf(');
      const fn = new Function('T', 'iff', 'ltf', 'min', 'max', `return ${js};`) as (...a: unknown[]) => number;
      for (const t of [0, 0.7, 1.9, 3, 4.5, 6, 7]) {
        const v = fn(t, (c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a < b ? 1 : 0), Math.min, Math.max);
        expect(v).toBeCloseTo(cameraAt(kf, t)[ch], 6);
      }
    }
  });
  it('splitting keeps the camera continuous', () => {
    const kf = [{ t: 0, zoom: 1, x: 0.5, y: 0.5, ease: 'linear' as const }, { t: 4, zoom: 3, x: 0.5, y: 0.5, ease: 'linear' as const }];
    const [l, r] = splitKeyframes(kf, 2);
    expect(cameraAt(l, 2).zoom).toBeCloseTo(2);
    expect(cameraAt(r, 0).zoom).toBeCloseTo(2);
    expect(cameraAt(r, 2).zoom).toBeCloseTo(3);
  });
});

describe('transitions + cards', () => {
  const t = VoiceoverTimelineSchema.parse({
    clips: [
      { id: 'i', kind: 'card', card: { duration: 3, title: 'Hi' } },
      { id: 'a', src_in: 0, src_out: 10, transition: { kind: 'crossfade', duration: 0.5 } },
      { id: 'b', src_in: 20, src_out: 30 },
      { id: 'c', src_in: 40, src_out: 50, transition: { kind: 'slide_left', duration: 1 } },
    ],
  });
  it('overlaps clips by their transition', () => {
    expect(clipStarts(t)).toEqual([0, 2.5, 12.5, 21.5]);
    expect(timelineDuration(t)).toBe(31.5);
    expect(locateOutputTime(t, 2.6)).toMatchObject({ index: 1 });
    expect(locateOutputTime(t, 1)).toMatchObject({ index: 0, srcT: 0 });
  });
  it('joins runs with xfade at the right offsets, normalising timebases', () => {
    const g = fg(buildJoinArgs({ segmentPaths: ['0', '1', '2', '3'], clips: t.clips, withAudio: false, quality: 'standard', outPath: 'j.mp4' }));
    expect(g).toContain('[1:v][2:v]concat=n=2');
    expect(g).toContain('xfade=transition=fade:duration=0.5:offset=2.5');
    expect(g).toContain('xfade=transition=slideleft:duration=1:offset=21.5');
    expect(g).toContain('settb=AVTB');
  });
  it('renders card titles as ASS', () => {
    expect(buildCardAss(t.clips[0].card!, 1920, 1080)).toContain('Hi');
  });
});

describe('final pass', () => {
  const canvas = computeCanvas({ width: 2580, height: 1540 }, { aspect: '16:9', fit: 'blur' });
  it('trims takes, fades voice, ducks music, normalises loudness, adds logo + metadata', () => {
    const args = buildFinalArgs({
      video: { kind: 'file', path: 'j.mp4' }, canvas, quality: 'standard', total: 30, outPath: 'o.mp4',
      voices: [{ path: 'a.mp3', start: 1.5, volume: 1 }, { path: 'b.mp3', start: 10, volume: 0.8, audioIn: 0.5, audioOut: 4 }],
      music: { path: 'm.mp3', settings: { url: 'https://x/m.mp3', name: 'm', volume: 0.3, duck: true, duck_amount: 0.8, fade_in: 1, fade_out: 2, loop: true } },
      logo: { path: 'l.png', branding: { logo_url: 'https://x/l.png', logo_position: 'tr', logo_size: 0.1, logo_opacity: 0.8, disclosure_badge: false, palette: [] } },
      redactions: [{ id: 'r', kind: 'blur', start: 1, end: 5, x: 0.5, y: 0.1, w: 0.2, h: 0.05, from_x: 0, from_y: 0, color: '#000000', intensity: 0.5 }],
      audio: { loudness: 'youtube', voice_fades: true },
      metadata: { comment: 'AI voice' },
    });
    const g = fg(args);
    expect(g).toContain('adelay=1500|1500');
    expect(g).toContain('atrim=start=0.5:end=4');
    expect(g).toContain('afade=t=in:st=0:d=0.015');
    expect(g).toContain('sidechaincompress');
    expect(g).toContain('loudnorm=I=-14');
    expect(g).toContain("enable='between(t,1,5)'");
    expect(g).toContain('colorchannelmixer=aa=0.8');
    expect(args).toContain('-stream_loop');
    expect(args).toContain('comment=AI voice');
  });
  it('emits silence when there is no audio at all', () => {
    const g = fg(buildFinalArgs({ video: { kind: 'concat', path: 'l' }, canvas, quality: 'draft', total: 5, outPath: 'o', voices: [] }));
    expect(g).toContain('anullsrc');
  });
});

describe('vertical framing (cover follows the camera)', () => {
  const src = { width: 1920, height: 1080 };
  const v = computeCanvas(src, { aspect: '9:16', fit: 'cover', quality: 'standard' });
  const sq = computeCanvas(src, { aspect: '1:1', fit: 'cover', quality: 'standard' });
  const fw = Math.round(v.content!.w / 2) * 2;
  it('centre-crops when the camera never moves', () => {
    expect(coverChain(clip(), v, 'standard')).toEqual([`scale=${fw}:1920:flags=lanczos`, 'setsar=1', 'crop=1080:1920:(iw-ow)/2:(ih-oh)/2']);
    expect(coverViewAt(clip(), v, 3).ox).toBeCloseTo((fw - 1080) / 2, 0);
  });
  it('follows the focus point and only zooms past what the narrow window already shows', () => {
    const c = clip({ keyframes: [{ t: 0, zoom: 1, x: 0.2, y: 0.5 }, { t: 4, zoom: 1.8, x: 0.8, y: 0.3 }] });
    const g = fg(buildSegmentArgs({ srcPath: 's', outPath: 'o', clip: c, canvas: v, quality: 'standard', withAudio: false }));
    expect(g).toContain(`scale=${fw}:1920`);
    expect(g).toContain("crop=1080:1920:x='(max(0,min(");
    expect(g).not.toContain('zoompan'); // 1.8× is still wider than a 9:16 window (≈3.2×)
    expect(coverViewAt(c, v, 0).ox).toBeCloseTo(Math.max(0, 0.2 * fw - 540), 0);
    expect(coverViewAt(c, v, 4).ox).toBeCloseTo(Math.min(fw - 1080, 0.8 * fw - 540), 0);
    // 1:1 is only ≈1.8× tighter, so a 2.4× camera zooms a little further.
    const z = clip({ keyframes: [{ t: 0, zoom: 2.4, x: 0.5, y: 0.4 }, { t: 2, zoom: 2.4, x: 0.5, y: 0.4 }] });
    const gs = fg(buildSegmentArgs({ srcPath: 's', outPath: 'o', clip: z, canvas: sq, quality: 'standard', withAudio: false }));
    expect(gs).toContain('zoompan');
    expect(coverViewAt(z, sq, 1).zp).toBeCloseTo(2.4 / (Math.round(sq.content!.w / 2) * 2 / 1080), 2);
  });
  it('maps effects through the moving window; text keeps its screen position and stays on the canvas', () => {
    const tl = { clips: [clip({ src_in: 0, src_out: 10, keyframes: [{ t: 0, zoom: 1, x: 0.9, y: 0.5 }] })] };
    const at = coverContentAt(tl, v);
    expect(at(1).x).toBeCloseTo(-(fw - 1080), 0); // window flush right
    const ass = buildOverlayAss(
      [{ id: 'o', start: 1, end: 3, text: '5 · Path Finder: five quick questions', x: 0.12, y: 0.9, size: 46, color: '#FFFFFF', box: true, box_color: '#0B2E5C', animation: 'fade', kind: 'text', subtitle: '', tx: 0.5, ty: 0.5, font: 'Liberation Sans' }],
      1080, 1920, { content: { x: 0, y: 0, w: 1080, h: 1920 }, contentAt: at, textScale: 1, effects: [EffectSchema.parse({ id: 'e', kind: 'click', start: 1, end: 2, x: 0.85, y: 0.2 })] },
    );
    const pos = /\\pos\((\d+),(\d+)\)\\fad/.exec(ass)!;
    expect(Number(pos[1])).toBeGreaterThan(0); // pulled in from the left edge
    expect(Number(pos[2])).toBe(Math.round(0.9 * 1920));
    const click = /\\an7\\pos\((-?\d+),(-?\d+)\)\\p1/.exec(ass)!;
    expect(Number(click[1])).toBeCloseTo(0.85 * fw - (fw - 1080), -1);
  });
});

describe('ASS: overlays, effects, captions', () => {
  it('converts colours, animates and escapes text', () => {
    expect(assColor('#1565C0')).toBe('&H00C06515');
    const ass = buildOverlayAss([{ id: 'o', start: 1, end: 4, text: 'Step {1}\nnext', x: 0.5, y: 0.1, size: 54, color: '#FFFFFF', box: true, box_color: '#0B2E5C', animation: 'slide_up', kind: 'text', subtitle: '', tx: 0.5, ty: 0.5, font: 'Liberation Sans' }], 1920, 1080);
    expect(ass).toContain('\\move(960,156,960,108,0,400)');
    expect(ass).toContain('Step (1)\\Nnext');
  });
  it('draws effects and the disclosure badge', () => {
    const ass = buildOverlayAss([], 1920, 1080, {
      effects: [
        { id: 'c', kind: 'click', start: 1, end: 2, x: 0.5, y: 0.5, w: 0.1, h: 0.1, from_x: 0, from_y: 0, color: '#FF0000', intensity: 0.5 },
        { id: 's', kind: 'spotlight', start: 1, end: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.2, from_x: 0, from_y: 0, color: '#000000', intensity: 0.5 },
      ],
      disclosure: { position: 'tl', total: 10 },
    });
    expect(ass).toContain('\\p1');
    expect(ass).toContain('m 0 0 l 1920 0 l 1920 1080 l 0 1080 m 768 432');
    expect(ass).toContain('AI-generated voice');
    expect(arrowPath(0, 0, 100, 0, 10).startsWith('m 0 5')).toBe(true);
  });
  it('wraps long card titles in narrow frames and moves the subtitle below them', () => {
    // Regression: "Take the free 1-minute quiz" wrapped by itself in 9:16 and
    // its second line printed on top of the subtitle.
    const card = CardSchema.parse({ title: 'Take the free 1-minute quiz', subtitle: 'theskillpedia.com  ·  your personal learning path', animation: 'pop' });
    const tall = buildCardAss(card, 1080, 1920);
    expect(tall).toContain('Take the free\\N1-minute quiz');
    expect(tall).toContain('theskillpedia.com · your personal\\Nlearning path');
    expect(tall).toContain('\\pos(540,1175)'); // subtitle pushed below the 2-line title
    // 16:9: both fit on one line, so the layout (and the double spaces) are unchanged.
    const wide = buildCardAss(card, 1920, 1080);
    expect(wide).toContain('}Take the free 1-minute quiz');
    expect(wide).toContain('theskillpedia.com  ·  your personal learning path');
    expect(wide).toContain('\\pos(960,620)'); // 540 + 0.95 * 84, as before
  });
  it('places effects and overlays inside the recording box, not the whole frame', () => {
    // Regression: in a 9:16 / 1:1 export, clicks and highlights authored on the
    // 16:9 recording landed in the blurred bands, and step labels sized for
    // the full 1920px height ran off the left edge.
    const content = computeCanvas({ width: 1920, height: 1080 }, { aspect: '9:16', fit: 'blur' }).content;
    const ass = buildOverlayAss(
      [{ id: 'o', start: 1, end: 4, text: 'Step', x: 0.5, y: 0.1, size: 54, color: '#FFFFFF', box: true, box_color: '#0B2E5C', animation: 'slide_up', kind: 'text', subtitle: '', tx: 0.5, ty: 0.5, font: 'Liberation Sans' }],
      1080, 1920,
      {
        content,
        effects: [
          { id: 'c', kind: 'click', start: 1, end: 2, x: 0.5, y: 0.5, w: 0.1, h: 0.1, from_x: 0, from_y: 0, color: '#FF0000', intensity: 0.5 },
          { id: 'h', kind: 'highlight', start: 1, end: 2, x: 0.1, y: 0.1, w: 0.2, h: 0.1, from_x: 0, from_y: 0, color: '#FF0000', intensity: 0.5 },
        ],
      },
    );
    expect(ass).toContain('\\pos(540,960)'); // click at the box centre
    expect(ass).toContain('\\pos(0,687)'); // highlight top-left: (0.1-0.1)*1080, 656+(0.1-0.05)*608
    expect(ass).toContain('\\move(540,744,540,717,0,400)'); // label y = 656 + 0.1*608
    expect(ass).toContain('\\fs30'); // 54px authored at 1080 -> 608px-tall box
  });
  it('karaoke captions highlight one word per event', () => {
    const words = [{ word: 'hello', start: 0, end: 0.4 }, { word: 'world.', start: 0.5, end: 0.9 }, { word: 'next', start: 2, end: 2.4 }];
    expect(captionLines(words, 6).length).toBe(2);
    const ass = buildCaptionsAss(words, CaptionStyleSchema.parse({ style: 'hormozi' }), 1920, 1080);
    expect(ass.match(/Dialogue/g)?.length).toBe(3);
    expect(ass).toContain('HELLO');
  });
});

describe('smart-edit analysis', () => {
  it('diffs frames into a centroid and bounding box', () => {
    const a = new Uint8Array(100);
    const b = new Uint8Array(100);
    b[55] = 200;
    const d = diffFrames(a, b, 10, 10, 1);
    expect(d.changed).toBeCloseTo(0.01);
    expect(d.cx).toBeCloseTo(0.5);
  });
  it('turns idle stretches into speed/cut and local activity into focus + click', () => {
    const diffs = [];
    for (let i = 1; i <= 80; i++) {
      const t = i / 4;
      const local = t >= 10 && t < 12;
      diffs.push({ t, changed: local ? 0.01 : 0, cx: 0.2, cy: 0.3, bw: 0.1, bh: 0.1 });
    }
    const s = suggestEdits(diffs, 20, 0.25);
    expect(s.some((x) => x.kind === 'cut' && x.start < 1)).toBe(true);
    const focus = s.find((x) => x.kind === 'focus')!;
    expect(focus.x).toBeCloseTo(0.2);
    expect(focus.y).toBeCloseTo(0.3);
    expect(s.some((x) => x.kind === 'click')).toBe(true);
  });
});

describe('suggestions applied to a timeline', () => {
  it('cuts dead air, speeds waits, adds focus keyframes and maps source → output', () => {
    const base = VoiceoverTimelineSchema.parse({ clips: [{ id: 'a', src_in: 0, src_out: 60 }] });
    const t = applySuggestions(base, [
      { id: '1', kind: 'cut', start: 5, end: 15 },
      { id: '2', kind: 'speed', start: 30, end: 40, speed: 2 },
      { id: '3', kind: 'focus', start: 20, end: 25, x: 0.2, y: 0.3, zoom: 2 },
    ], ['cut', 'speed', 'focus']);
    expect(timelineDuration(t)).toBeCloseTo(45);
    expect(sourceToOutput(t, 10)).toBeNull();
    expect(sourceToOutput(t, 20)?.out).toBeCloseTo(10);
    expect(t.clips.some((c) => c.keyframes.length >= 4)).toBe(true);
  });
});

describe('scripts, spacing, pricing', () => {
  it('parses cue sheets, SRT and plain scripts', () => {
    expect(parseNarrationScript('CUE 1  |  start 0:00.0  |  max 17s\nHello there.\n\nCUE 2  |  start 0:17.1  |  max 9s\nNext bit.')).toEqual([{ start: 0, text: 'Hello there.' }, { start: 17.1, text: 'Next bit.' }]);
    expect(parseNarrationScript('1\n00:00:01,500 --> 00:00:03,000\nHi\n')).toEqual([{ start: 1.5, text: 'Hi' }]);
    expect(parseNarrationScript('One.\n\nTwo.')).toHaveLength(2);
    expect(parseNarrationScript('CUE 1 | start 0:00.5 | Too many courses?\nCUE 2 | start 0:04.0 | max 9s | Start here.')).toEqual([{ start: 0.5, text: 'Too many courses?' }, { start: 4, text: 'Start here.' }]);
  });
  it('normalises narration to 48 kHz stereo and pins the format before the limiter', () => {
    expect(buildAudioNormalizeArgs('in.mp3', 'out.wav')).toEqual(['-y', '-hide_banner', '-nostdin', '-i', 'in.mp3', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', 'out.wav']);
  });
  it('auto-spaces overlapping blocks', () => {
    const t = VoiceoverTimelineSchema.parse({ blocks: [{ id: 'a', start: 0, text: 'x'.repeat(140) }, { id: 'b', start: 5, text: 'y' }] });
    expect(autoSpaceTimelineBlocks(t).blocks[1].start).toBeCloseTo(10.25);
  });
  it('captions respect take trims', () => {
    const t = VoiceoverTimelineSchema.parse({ blocks: [{ id: 'v', start: 10, text: 'a b', audio_url: 'https://r2.test/a.mp3', audio_in: 1, words: [{ word: 'a', start: 0.2, end: 0.5 }, { word: 'b', start: 1.2, end: 1.5 }] }] });
    expect(timelineWords(t)).toEqual([{ word: 'b', start: 10.2, end: 10.5 }]);
  });
  it('prices by characters, minutes, quality and formats', () => {
    expect(quoteVoiceoverTtsCredits(2500)).toBe(50);
    expect(quoteVoiceoverRenderCredits(165)).toBe(18);
    expect(quoteVoiceoverRenderCredits(165, { quality: 'high', formats: 2 })).toBe(72);
    expect(quoteVoiceoverRenderCredits(30, { quality: 'draft' })).toBe(6);
  });
});
