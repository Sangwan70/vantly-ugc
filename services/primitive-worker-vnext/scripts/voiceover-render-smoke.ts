// Smoke-test the Voiceover Studio render plan against a real recording — no Temporal/R2 needed.
// Usage: npx tsx scripts/voiceover-render-smoke.ts <recording.mp4> <workdir> <aspect> [logo.png]
// Needs voice-a.mp3, voice-b.mp3 and music.mp3 in <workdir> (any audio; e.g. ffmpeg -f lavfi -i sine=d=6 voice-a.mp3).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VoiceoverTimelineSchema, timelineDuration, timelineWords, type VoiceoverAspect } from '@vantly-ugc/schema';
import {
  buildCaptionsAss, buildCardAss, buildCardSegmentArgs, buildFinalArgs, buildJoinArgs, buildOverlayAss, buildSegmentArgs, computeCanvas, hasTransitions,
} from '../src/lib/voiceover-ffmpeg.js';

const [src, work, aspect, logo] = process.argv.slice(2);
const words = (text: string, dur: number) => {
  const ws = text.split(' ');
  const step = dur / ws.length;
  return ws.map((w, i) => ({ word: w, start: i * step, end: (i + 0.9) * step }));
};
const A = 'What if you could watch a course before paying a single rupee?';
const B = 'On the left, filter by category, topic, level, free or paid.';
const t = VoiceoverTimelineSchema.parse({
  clips: [
    { id: 'intro', kind: 'card', card: { duration: 3, title: 'Never buy the wrong course', subtitle: 'EP 2 · TheSkillPedia', animation: 'slide_up' } },
    { id: 'a', src_in: 2, src_out: 10, transition: { kind: 'crossfade', duration: 0.6 } },
    {
      id: 'b', src_in: 20, src_out: 30, transition: { kind: 'slide_left', duration: 0.5 },
      keyframes: [
        { t: 0, zoom: 1, x: 0.5, y: 0.5, ease: 'ease_in_out' },
        { t: 2, zoom: 1.9, x: 0.15, y: 0.45, ease: 'hold' },
        { t: 5, zoom: 1.9, x: 0.15, y: 0.45, ease: 'ease_in_out' },
        { t: 7, zoom: 1.6, x: 0.55, y: 0.35, ease: 'ease_in_out' },
        { t: 9.5, zoom: 1, x: 0.5, y: 0.5, ease: 'linear' },
      ],
    },
    { id: 'c', src_in: 60, src_out: 72, speed: 1.5 },
  ],
  blocks: [
    { id: 'b1', start: 3.2, text: A, audio_url: 'https://x.test/a.mp3', audio_duration: 6, words: words(A, 6) },
    { id: 'b2', start: 10.5, text: B, audio_url: 'https://x.test/b.mp3', audio_duration: 7, audio_in: 0.5, audio_out: 6.5, words: words(B, 7) },
  ],
  overlays: [
    { id: 'lt', kind: 'lower_third', start: 3.5, end: 8, text: 'Courses page', subtitle: 'theskillpedia.com/courses', x: 0.05, y: 0.82, size: 52, box_color: '#0B2E5C' },
    { id: 'co', kind: 'callout', start: 13.5, end: 17, text: 'Filters', x: 0.62, y: 0.25, tx: 0.42, ty: 0.42, size: 46, box_color: '#1565C0', animation: 'pop' },
    { id: 'tw', start: 18, end: 22, text: 'Step 2/6 · Course cards', animation: 'typewriter', y: 0.1, size: 48, box_color: '#1565C0' },
  ],
  effects: [
    { id: 'e1', kind: 'click', start: 6.0, end: 6.8, x: 0.43, y: 0.46, color: '#FF3B30' },
    { id: 'e2', kind: 'spotlight', start: 19, end: 23, x: 0.5, y: 0.55, w: 0.5, h: 0.4, intensity: 0.7 },
    { id: 'e3', kind: 'highlight', start: 24, end: 27, x: 0.3, y: 0.6, w: 0.25, h: 0.2, color: '#FFD400' },
    { id: 'e4', kind: 'arrow', start: 24, end: 27, x: 0.3, y: 0.5, from_x: 0.6, from_y: 0.25, color: '#FFD400' },
    { id: 'e5', kind: 'blur', start: 3, end: 30, x: 0.86, y: 0.045, w: 0.12, h: 0.05, intensity: 0.8 },
  ],
  output: { aspect, captions: { enabled: true, style: 'hormozi' }, quality: 'standard' },
  audio: { music: { url: 'https://x.test/m.mp3', volume: 0.5, duck: true, duck_amount: 0.8 }, loudness: 'youtube' },
  branding: { logo_url: logo ? 'https://x.test/logo.png' : null, logo_position: 'tr', logo_size: 0.1, disclosure_badge: true },
});
const total = timelineDuration(t);
const canvas = computeCanvas({ width: 2580, height: 1540 }, { aspect: aspect as VoiceoverAspect, fit: 'blur', quality: 'standard' });
console.log('canvas', canvas.W, 'x', canvas.H, 'total', total.toFixed(2));
const run = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
let t0 = Date.now();
const segs = t.clips.map((clip, i) => {
  const out = join(work, `seg-${i}.mp4`);
  if (clip.kind === 'card' && clip.card) {
    const assPath = join(work, `card-${i}.ass`);
    writeFileSync(assPath, buildCardAss(clip.card, canvas.W, canvas.H));
    run(buildCardSegmentArgs({ card: clip.card, canvas, quality: 'standard', assPath, logoPath: logo ?? null, withAudio: false, outPath: out }));
  } else {
    run(buildSegmentArgs({ srcPath: src, outPath: out, clip, canvas, quality: 'standard', withAudio: false }));
  }
  return out;
});
console.log('segments s', (Date.now() - t0) / 1000);
t0 = Date.now();
const joined = join(work, 'joined.mp4');
if (hasTransitions(t.clips)) run(buildJoinArgs({ segmentPaths: segs, clips: t.clips, withAudio: false, quality: 'standard', outPath: joined, xfadeName: (k) => (k === 'zoom' ? 'circleopen' : ({ crossfade: 'fade', slide_left: 'slideleft', fade_black: 'fadeblack', slide_up: 'slideup', wipe: 'wipeleft' } as Record<string, string>)[k] ?? 'fade') }));
console.log('join s', (Date.now() - t0) / 1000);
writeFileSync(join(work, 'ov.ass'), buildOverlayAss(t.overlays, canvas.W, canvas.H, { effects: t.effects.filter((e) => e.kind !== 'blur'), disclosure: { position: 'tl', total } }));
writeFileSync(join(work, 'cap.ass'), buildCaptionsAss(timelineWords(t), t.output.captions, canvas.W, canvas.H));
t0 = Date.now();
run(buildFinalArgs({
  video: { kind: 'file', path: joined },
  voices: [
    { path: join(work, 'voice-a.mp3'), start: 3.2, volume: 1 },
    { path: join(work, 'voice-b.mp3'), start: 10.5, volume: 1, audioIn: 0.5, audioOut: 6.5 },
  ],
  canvas, quality: 'standard',
  redactions: t.effects.filter((e) => e.kind === 'blur'),
  overlayAssPath: join(work, 'ov.ass'), captionsAssPath: join(work, 'cap.ass'),
  logo: logo ? { path: logo, branding: t.branding } : null,
  music: { path: join(work, 'music.mp3'), settings: t.audio.music! },
  audio: t.audio,
  metadata: { title: 'smoke', comment: 'Narration is AI-generated (ElevenLabs).' },
  total, outPath: join(work, `final-${aspect.replace(':', 'x')}.mp4`),
}));
console.log('final s', (Date.now() - t0) / 1000);
