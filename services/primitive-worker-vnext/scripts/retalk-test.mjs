// One-off: real footage + video-to-video lip sync (EvoLink VideoRetalk). Only the
// mouth should change, so the face, expressions and clothes stay the user's own.
// Runs inside the production primitive-worker-vnext container:
//
//   docker cp /tmp/real-talk.mp4 "$(docker compose --env-file .env.prod ps -q primitive-worker-vnext)":/tmp/real-talk.mp4
//   docker compose --env-file .env.prod exec -T \
//     -e VIDEO_FILE=/tmp/real-talk.mp4 -e AUDIO_URL='https://…/line.mp3' \
//     primitive-worker-vnext node --input-type=module - < services/primitive-worker-vnext/scripts/retalk-test.mjs
//
// VIDEO_FILE: real clip of the user talking to camera (2–120 s, 640–2048 px a side).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = '/app/services/primitive-worker-vnext/dist';
const { getConfig } = await import(`${ROOT}/config.js`);
const { r2UploadVnext } = await import(`${ROOT}/client/r2.js`);
const { pollEvolinkTask, extractEvolinkVideoUrl } = await import(`${ROOT}/client/evolink.js`);
const { withEvolinkSlot } = await import(`${ROOT}/client/evolink-pool.js`);

const { VIDEO_FILE, AUDIO_URL } = process.env;
if (!VIDEO_FILE || !AUDIO_URL) throw new Error('Set VIDEO_FILE (real clip inside the container) and AUDIO_URL (Studio narration MP3)');
const cfg = getConfig();
const runId = `retalk-test-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), 'retalk-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fetchBuf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};

const source = await r2UploadVnext(cfg.r2, runId, 'source.mp4', readFileSync(VIDEO_FILE), 'video/mp4');
log('source uploaded', source.publicUrl);

const task = await withEvolinkSlot(async (apiKey) => {
  const r = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'videoretalk', video_url: source.publicUrl, audio_url: AUDIO_URL, video_extension: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`evolink submit ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  log('submitted', j.id, JSON.stringify(j.usage ?? {}));
  return { id: j.id, done: await pollEvolinkTask(apiKey, j.id) };
});
const videoUrl = extractEvolinkVideoUrl(task.done);
if (!videoUrl) throw new Error(`task ${task.id} finished without a video URL: ${JSON.stringify(task.done).slice(0, 400)}`);

const raw = join(dir, 'raw.mp4'), audio = join(dir, 'audio.mp3'), out = join(dir, 'retalk.mp4');
writeFileSync(raw, await fetchBuf(videoUrl));
writeFileSync(audio, await fetchBuf(AUDIO_URL));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out], { stdio: 'inherit' });
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', raw]).toString().trim();
const final = await r2UploadVnext(cfg.r2, runId, 'retalk.mp4', readFileSync(out), 'video/mp4');

console.log('\n===== RETALK TEST READY =====');
console.log('Task:      ', task.id);
console.log('Video:     ', final.publicUrl);
console.log('Source:    ', source.publicUrl);
console.log('Size/dur:  ', probe.replace(/\n/g, ' | '));
console.log('Usage:     ', JSON.stringify(task.done.usage ?? '(not reported)'));
