// One-off (presenter layer, phase 0): one lip-synced presenter take of the user,
// from their own photo + a frame and a clip of them speaking, driven by a real
// Voiceover Studio narration MP3. Answers two questions before any feature code:
// does Seedance hold lip sync for a full take, and what does EvoLink charge.
//
// Seedance's default moderation rejects real faces (even a gpt-image redraw of
// one). EvoLink's documented `content_filter: false` relaxes that for consented
// real-person footage (illegal content is still enforced) and bills at 1.1x.
//
// Runs inside the production primitive-worker-vnext container (it already holds
// the EvoLink keys and R2 credentials):
//
//   docker cp /tmp/presenter-refs "$(docker compose --env-file .env.prod ps -q primitive-worker-vnext)":/tmp/presenter-refs
//   docker compose --env-file .env.prod exec -T \
//     -e AUDIO_URL='https://…/block.mp3' \
//     primitive-worker-vnext node --input-type=module - < services/primitive-worker-vnext/scripts/presenter-test.mjs
//
// REFS_DIR (default /tmp/presenter-refs) holds face.jpg (identity, current look),
// speak.jpg (a frame of them talking to camera) and motion.mp4 (2-15 s of them
// speaking with natural gestures, no audio). Optional: NO_MOTION=1 (skip the
// clip; input video seconds are billed), DURATION (5|10|15, default 10),
// ASPECT (1:1|9:16, default 1:1), SEED. Prints every URL at the end.

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

const AUDIO_URL = process.env.AUDIO_URL;
if (!AUDIO_URL) throw new Error('Set AUDIO_URL to a Voiceover Studio narration MP3');
const REFS = process.env.REFS_DIR || '/tmp/presenter-refs';
const DURATION = Number(process.env.DURATION || 10);
const ASPECT = process.env.ASPECT || '1:1';
const SEED = Number(process.env.SEED || 4242);
const WITH_MOTION = process.env.NO_MOTION !== '1';
const cfg = getConfig();
const runId = `presenter-test-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), 'presenter-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fetchBuf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const up = async (name, type) => (await r2UploadVnext(cfg.r2, runId, name, readFileSync(join(REFS, name)), type)).publicUrl;

// 1. References -> R2 (EvoLink fetches them from the public bucket)
const face = await up('face.jpg', 'image/jpeg');
const speak = await up('speak.jpg', 'image/jpeg');
const motion = WITH_MOTION ? await up('motion.mp4', 'video/mp4') : null;
log('refs uploaded', { face, speak, motion });

// 2. One take: identity from @image1, speaking style from @image2 (+ @video1), mouth from @audio1
const prompt = [
  '@image1 is the man\'s face and current look: keep his exact identity, rimless glasses, moustache, hair and dark green t-shirt in every frame.',
  `@image2${motion ? ' and @video1 show' : ' shows'} the same man talking to the camera: copy his natural speaking style, the way he moves his head and eyebrows and now and then raises one open hand to make a point.`,
  'He sits in front of a city skyline seen from a high-rise balcony, as in @image2, in soft even daylight.',
  'He speaks directly to the camera, his mouth lip-synced precisely to the speech in @audio1 from the first word to the last, then he pauses with a gentle smile.',
  'His face, glasses and clothing always match @image1.',
  'Medium close-up, head and shoulders, centred, steady camera, natural matte skin, no text, no captions.',
].join(' ');
const body = {
  model: process.env.EVOLINK_SEEDANCE_MODEL || 'seedance-2.0-reference-to-video',
  prompt,
  image_urls: [face, speak],
  ...(motion ? { video_urls: [motion] } : {}),
  audio_urls: [AUDIO_URL],
  duration: DURATION,
  aspect_ratio: ASPECT,
  generate_audio: false,
  quality: '720p',
  seed: SEED,
  content_filter: false, // consented real-person likeness (see header)
};
const task = await withEvolinkSlot(async (apiKey) => {
  const r = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`evolink submit ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  log('submitted', j.id, { model: body.model, DURATION, ASPECT, SEED, motion: !!motion });
  return { id: j.id, done: await pollEvolinkTask(apiKey, j.id) };
});
const videoUrl = extractEvolinkVideoUrl(task.done);
if (!videoUrl) throw new Error(`task ${task.id} finished without a video URL`);

// 3. Seedance returns a silent clip; put the narration back on so sync can be judged by eye and ear
const silent = join(dir, 'silent.mp4'), audio = join(dir, 'audio.mp3'), out = join(dir, 'presenter.mp4');
writeFileSync(silent, await fetchBuf(videoUrl));
writeFileSync(audio, await fetchBuf(AUDIO_URL));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', out], { stdio: 'inherit' });
const silentR2 = await r2UploadVnext(cfg.r2, runId, 'presenter-silent.mp4', readFileSync(silent), 'video/mp4');
const final = await r2UploadVnext(cfg.r2, runId, 'presenter.mp4', readFileSync(out), 'video/mp4');

const usage = Object.fromEntries(Object.entries(task.done).filter(([k]) => /usage|cost|credit|price|billing/i.test(k)));
console.log('\n===== PRESENTER TEST READY =====');
console.log('Task:      ', task.id);
console.log('With voice:', final.publicUrl);
console.log('Silent:    ', silentR2.publicUrl);
console.log('Charge:    ', Object.keys(usage).length ? JSON.stringify(usage) : '(not reported; check the EvoLink dashboard)');
