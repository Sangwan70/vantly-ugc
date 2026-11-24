// Print smart-edit suggestions for a recording: npx tsx scripts/voiceover-analyze-smoke.ts <recording.mp4> <width> <height> <duration>
import { analyzeRecording } from '../src/activities/voiceover-prepare.js';
const [p, w, h, d] = process.argv.slice(2);
const t0 = Date.now();
const s = await analyzeRecording(p, Number(d), Number(w), Number(h));
const by: Record<string, number> = {};
for (const x of s) by[x.kind] = (by[x.kind] ?? 0) + 1;
console.log('took', (Date.now() - t0) / 1000, 's', by);
for (const x of s.filter((x) => x.kind !== 'click').slice(0, 25)) console.log(x.kind.padEnd(6), x.start.toFixed(1), '→', x.end.toFixed(1), x.zoom ? `zoom ${x.zoom} @ ${x.x!.toFixed(2)},${x.y!.toFixed(2)}` : x.speed ? `${x.speed}×` : '', '·', x.reason);
