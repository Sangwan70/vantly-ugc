// Smoke-test the Voiceover Studio render plan against a real recording, no Temporal/R2 needed.
// Usage: npx tsx scripts/voiceover-render-smoke.ts <recording.mp4> <workdir> <source|16:9|9:16|1:1>
// (voices: put two mp3s at $HOME/vo/v1.mp3 and v2.mp3, e.g. ffmpeg -f lavfi -i sine=d=6 v1.mp3)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VoiceoverTimelineSchema, timelineDuration, timelineWords } from '@vantly-ugc/schema';
import { buildSegmentArgs, buildFinalArgs, buildOverlayAss, computeCanvas, concatListFile, captionAspect } from '../src/lib/voiceover-ffmpeg.js';
import { generateAss } from '../src/lib/ass.js';

const [src, work, aspect] = process.argv.slice(2);
const words = (text: string, dur: number) => {
  const ws = text.split(' '); const step = dur / ws.length;
  return ws.map((w, i) => ({ word: w, start: i * step, end: (i + 0.9) * step }));
};
const t = VoiceoverTimelineSchema.parse({
  clips: [
    { id: 'a', src_in: 2, src_out: 10, fade_in: 0.5 },
    { id: 'b', src_in: 20, src_out: 30, zoom: { mode: 'focus', scale: 1.8, x: 0.15, y: 0.4, ease: 0.8 } },
    { id: 'c', src_in: 60, src_out: 75, speed: 1.5, zoom: { mode: 'in', scale: 1.3, x: 0.5, y: 0.3 } },
    { id: 'd', src_in: 120, src_out: 126, fade_out: 0.6 },
  ],
  blocks: [
    { id: 'b1', start: 0.3, text: 'What if you could watch a course before paying a single rupee', audio_url: 'https://x.test/v1.mp3', audio_duration: 6, words: words('What if you could watch a course before paying a single rupee', 6) },
    { id: 'b2', start: 8.5, text: 'On the left filter by category topic level free or paid', audio_url: 'https://x.test/v2.mp3', audio_duration: 7, words: words('On the left filter by category topic level free or paid', 7) },
  ],
  overlays: [
    { id: 'o1', start: 0.5, end: 7.5, text: 'Watch the course BEFORE you pay', animation: 'pop', y: 0.1 },
    { id: 'o2', start: 8, end: 17.5, text: 'Step 1/6 · Filters · Sort', animation: 'slide_up', y: 0.88, box_color: '#1565C0' },
    { id: 'o3', start: 18, end: 28, text: 'Step 2/6 · Course cards', animation: 'fade', box: false, y: 0.88 },
  ],
  output: { aspect, fit: 'blur', captions: { enabled: true, style: 'minimal' } },
});
const canvas = computeCanvas({ width: 2580, height: 1540 }, t.output);
console.log('canvas', canvas, 'total', timelineDuration(t));
const segs: string[] = [];
let t0 = Date.now();
t.clips.forEach((clip, i) => {
  const out = join(work, `seg-${i}.mp4`);
  execFileSync('ffmpeg', buildSegmentArgs({ srcPath: src, outPath: out, clip, canvas, withAudio: false }), { stdio: ['ignore', 'ignore', 'inherit'] });
  segs.push(out);
});
console.log('segments s', (Date.now() - t0) / 1000);
writeFileSync(join(work, 'list.txt'), concatListFile(segs));
writeFileSync(join(work, 'ov.ass'), buildOverlayAss(t.overlays, canvas.W, canvas.H));
writeFileSync(join(work, 'cap.ass'), generateAss(timelineWords(t), 'minimal', captionAspect(canvas.W, canvas.H)));
t0 = Date.now();
const args = buildFinalArgs({ concatListPath: join(work, 'list.txt'), voices: [{ path: process.env.HOME + '/vo/v1.mp3', start: 0.3, volume: 1 }, { path: process.env.HOME + '/vo/v2.mp3', start: 8.5, volume: 1 }], canvas, fit: 'blur', overlayAssPath: join(work, 'ov.ass'), captionsAssPath: join(work, 'cap.ass'), total: timelineDuration(t), outPath: join(work, `final-${aspect.replace(':', 'x')}.mp4`) });
execFileSync('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log('final s', (Date.now() - t0) / 1000);
