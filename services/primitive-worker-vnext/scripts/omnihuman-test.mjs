// One-off: is OmniHuman 1.5 (audio-driven talking head) a better presenter
// engine than Seedance reference-to-video? One take of a real Studio line from
// the dressed presenter photo. Runs inside the production primitive-worker-vnext
// container (EvoLink key + R2 credentials):
//
//   docker compose --env-file .env.prod exec -T \
//     -e IMAGE_URL='https://…/presenter-look.png' -e AUDIO_URL='https://…/line.mp3' \
//     primitive-worker-vnext node --input-type=module - < services/primitive-worker-vnext/scripts/omnihuman-test.mjs
//
// Optional: SEED, FAST=1 (pe_fast_mode). Prints the take (with the voice muxed
// back on) and EvoLink's reported usage.

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

const { IMAGE_URL, AUDIO_URL } = process.env;
if (!IMAGE_URL || !AUDIO_URL) throw new Error('Set IMAGE_URL (presenter photo) and AUDIO_URL (Studio narration MP3)');
const cfg = getConfig();
const runId = `omnihuman-test-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), 'omni-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fetchBuf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};

const body = {
  model: 'omnihuman-1.5',
  image_urls: [IMAGE_URL],
  audio_url: AUDIO_URL,
  prompt: 'He speaks warmly and confidently to the camera like a teacher, with small natural nods. When he is not speaking his lips are closed in a gentle smile.',
  seed: Number(process.env.SEED || 4242),
  pe_fast_mode: process.env.FAST === '1',
};
const task = await withEvolinkSlot(async (apiKey) => {
  const r = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`evolink submit ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  log('submitted', j.id, JSON.stringify(j.task_info ?? {}));
  return { id: j.id, done: await pollEvolinkTask(apiKey, j.id) };
});
const videoUrl = extractEvolinkVideoUrl(task.done);
if (!videoUrl) throw new Error(`task ${task.id} finished without a video URL: ${JSON.stringify(task.done).slice(0, 400)}`);

const raw = join(dir, 'raw.mp4'), audio = join(dir, 'audio.mp3'), out = join(dir, 'omnihuman.mp4');
writeFileSync(raw, await fetchBuf(videoUrl));
writeFileSync(audio, await fetchBuf(AUDIO_URL));
// Keep the model's own audio track out: our ElevenLabs line is the only sound.
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out], { stdio: 'inherit' });
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', raw]).toString().trim();
const final = await r2UploadVnext(cfg.r2, runId, 'omnihuman.mp4', readFileSync(out), 'video/mp4');

console.log('\n===== OMNIHUMAN TEST READY =====');
console.log('Task:      ', task.id);
console.log('Video:     ', final.publicUrl);
console.log('Size/dur:  ', probe.replace(/\n/g, ' | '));
console.log('Usage:     ', JSON.stringify(task.done.usage ?? '(not reported)'));
