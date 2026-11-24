// One-off: make the series brand sting — two cartoon students (in the logo's
// orange and blue) leap, morph into the logo's two figures, sparkle, and settle
// on the real logo. Runs inside the production primitive-worker-vnext container
// (it already holds the OpenAI + EvoLink keys and R2 credentials):
//
//   docker compose --env-file .env.prod exec -T \
//     -e LOGO_URL='https://…/logo.png' \
//     primitive-worker-vnext node --input-type=module - < services/primitive-worker-vnext/scripts/brand-sting.mjs
//
// Optional env: FIRST_FRAME_URL (skip image generation and reuse an approved frame),
// SEED (number). Prints the frame and video URLs at the end.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = '/app/services/primitive-worker-vnext/dist';
const { getConfig } = await import(`${ROOT}/config.js`);
const { generateImageWithFallback } = await import(`${ROOT}/client/openai.js`);
const { r2UploadVnext } = await import(`${ROOT}/client/r2.js`);
const { pollEvolinkTask, extractEvolinkVideoUrl } = await import(`${ROOT}/client/evolink.js`);
const { withEvolinkSlot } = await import(`${ROOT}/client/evolink-pool.js`);

const LOGO_URL = process.env.LOGO_URL;
if (!LOGO_URL) throw new Error('Set LOGO_URL to the brand logo PNG');
const cfg = getConfig();
const runId = `brand-sting-${randomUUID()}`;
const dir = mkdtempSync(join(tmpdir(), 'sting-'));
const W = 1536, H = 864; // 16:9, the largest that gpt-image-2's 1536x1024 crops to
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
const fetchBuf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};

// 1. Logo
const logoPath = join(dir, 'logo.png');
writeFileSync(logoPath, await fetchBuf(LOGO_URL));
log('logo downloaded');

// 2. Last frame: the real logo, centred on white, 16:9.
const lastPath = join(dir, 'last.png');
ff(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-i', logoPath, '-filter_complex',
  `[1:v]scale=${Math.round(W * 0.62)}:-2[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2`, '-frames:v', '1', lastPath]);
const last = await r2UploadVnext(cfg.r2, runId, 'last-frame.png', readFileSync(lastPath), 'image/png');
log('last frame', last.publicUrl);

// 3. First frame: two cartoon students in the logo's colours, poses echoing its two figures.
let firstUrl = process.env.FIRST_FRAME_URL;
if (!firstUrl) {
  const prompt = [
    'Clean flat 2D vector cartoon illustration, modern corporate explainer style, plain pure white background, wide 16:9 composition.',
    'Two cheerful young Indian college students, full body, standing close together in the centre of the frame and leaping joyfully with both arms raised high in a sweeping curve.',
    'On the left, a young woman in a bright orange hoodie and orange trousers, the same orange as the left figure of the reference logo.',
    'On the right, a young man in a royal blue hoodie and blue trousers, the same blue as the reference logo.',
    'Their raised arms and curved bodies echo the two swooping arc figures of the logo mark (orange figure and blue figure).',
    'Soft subtle shadows, crisp outlines, friendly faces. No text, no letters, no logo, no other objects.',
  ].join(' ');
  log('generating first frame with', cfg.openai.imageModel);
  const img = await generateImageWithFallback(cfg.openai, { model: cfg.openai.imageModel, prompt, referencePng: readFileSync(logoPath), size: '1536x1024' });
  const rawPath = join(dir, 'first-raw.png');
  const firstPath = join(dir, 'first.png');
  writeFileSync(rawPath, img.bytes);
  // Fit the whole 3:2 picture inside 16:9 on white (cropping cut off raised hands and feet).
  ff(['-i', rawPath, '-vf', `scale=-2:${H},pad=${W}:${H}:(ow-iw)/2:0:white`, '-frames:v', '1', firstPath]);
  firstUrl = (await r2UploadVnext(cfg.r2, runId, 'first-frame.png', readFileSync(firstPath), 'image/png')).publicUrl;
}
log('first frame', firstUrl);

// 4. Seedance 2.0 image-to-video, first frame → last frame.
const prompt = [
  'Premium brand logo reveal, smooth motion design, clean white background, locked-off camera.',
  'The two cartoon students leap and spin upward together, leaving glowing orange and blue light trails.',
  'Mid-air their bodies stretch and morph into two sweeping arcs — the woman into the orange arc, the man into the blue arc — shrinking smoothly into the logo mark while small golden sparkles burst and drift.',
  'A bright light sweep glides across the wordmark from left to right as it appears.',
  'The video ends exactly on the final frame: the complete logo, perfectly still and sharp.',
].join(' ');
const task = await withEvolinkSlot(async (apiKey) => {
  const body = {
    model: 'seedance-2.0-image-to-video',
    prompt,
    image_urls: [firstUrl, last.publicUrl],
    duration: 5,
    aspect_ratio: 'adaptive',
    quality: '1080p',
    generate_audio: false,
    ...(process.env.SEED ? { seed: Number(process.env.SEED) } : {}),
  };
  const r = await fetch('https://api.evolink.ai/v1/videos/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`EvoLink submit ${r.status}: ${text.slice(0, 400)}`);
  const id = JSON.parse(text).id;
  log('seedance task', id, '— waiting (usually 1–3 min)');
  return pollEvolinkTask(apiKey, id);
});
const videoUrl = extractEvolinkVideoUrl(task);
if (!videoUrl) throw new Error(`Seedance finished without a video: ${JSON.stringify(task).slice(0, 400)}`);

// 5. Keep it on our own storage (EvoLink links expire after 24 h).
const sting = await r2UploadVnext(cfg.r2, runId, 'brand-sting.mp4', await fetchBuf(videoUrl), 'video/mp4');
console.log('\nBRAND STING READY');
console.log('first frame :', firstUrl);
console.log('last frame  :', last.publicUrl);
console.log('sting video :', sting.publicUrl);
