// DISPOSABLE probe — not part of the pipeline, not committed.
// Tests: (1) can gpt-image-2 produce a clean stylized cartoon/animal character,
// (2) does OpenAI moderation flag mild kid-story peril or animal casts,
// (3) [gated on EVOLINK_API_KEYS] does Seedance PRESERVE that stylized look
//     when driven as a talking-head clip, or drift the character back toward
//     photorealism — the single unvalidated bet the whole feature rests on.
// env vars come from --env-file=../../.env.local passed on the command line
// (Node's native flag) — no dotenv package needed/installed in this workspace.
import { writeFileSync, mkdirSync } from 'node:fs';
import { getOpenAI, generateImage, classifyOpenAIError } from './src/client/openai.js';
import { r2UploadVnext } from './src/client/r2.js';
import { generateSimpleSelfieEvolink } from './src/client/evolink.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY not set');
const client = getOpenAI(apiKey);
const model = 'gpt-image-2';

// Output dir: right here in the current directory (not /tmp) so there's no
// separate mkdir step and no macOS /tmp permission surprises.
const OUT_DIR = './storybook-probe-output';
mkdirSync(OUT_DIR, { recursive: true });

const cases: { name: string; prompt: string }[] = [
  {
    name: 'character-fox',
    prompt:
      'A cute cartoon fox cub character design, flat vector cartoon style, bold clean outlines, simple flat colors, big expressive eyes, friendly kids storybook character, wearing a small blue scarf, standing pose, plain light background, no text, no watermark.',
  },
  {
    name: 'scene-tense',
    prompt:
      'Flat vector cartoon illustration, kids storybook style: a small cartoon fox cub looking worried and lost, standing alone in a dark forest at night with tall shadowy trees, moonlight, gentle non-scary mood appropriate for a bedtime story, bold clean outlines, simple flat colors, no text, no watermark.',
  },
  {
    name: 'scene-animal-cast',
    prompt:
      'Flat vector cartoon illustration, kids storybook style: a group of friendly cartoon animal characters (a fox, a rabbit, and an owl) having a picnic together in a sunny meadow, bold clean outlines, simple flat colors, cheerful mood, no text, no watermark.',
  },
];

async function main() {
  const results: Record<string, string> = {};
  let foxBytes: Buffer | null = null;
  for (const c of cases) {
    process.stdout.write(`\n=== ${c.name} ===\n`);
    try {
      const { bytes } = await generateImage(client, { model, prompt: c.prompt, size: '1024x1024' });
      const outPath = `${OUT_DIR}/${c.name}.png`;
      writeFileSync(outPath, bytes);
      console.log(`OK -> ${outPath} (${bytes.length} bytes)`);
      results[c.name] = 'OK';
      if (c.name === 'character-fox') foxBytes = bytes;
    } catch (err) {
      const cls = classifyOpenAIError(err);
      console.log(`FAILED: retryable=${cls.retryable} code=${cls.code} message=${cls.message}`);
      results[c.name] = `FAILED:${cls.code}`;
    }
  }
  console.log('\n=== SUMMARY (images) ===');
  console.log(JSON.stringify(results, null, 2));

  // Part 3: the Seedance style-preservation test — only runs if there's a real
  // Evolink key AND the fox reference image generated successfully above.
  const evolinkKeys = (process.env.EVOLINK_API_KEYS ?? '').trim();
  if (!evolinkKeys) {
    console.log('\n=== SEEDANCE STYLE TEST SKIPPED ===');
    console.log('EVOLINK_API_KEYS is not set — this is the one unvalidated part of Step 0.');
    console.log('Set EVOLINK_API_KEYS in .env.local and re-run this same script to complete it.');
    return;
  }
  if (!foxBytes) {
    console.log('\n=== SEEDANCE STYLE TEST SKIPPED — no fox reference image to test with ===');
    return;
  }
  console.log('\n=== seedance-style-test ===');
  try {
    const r2cfg = {
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucket: process.env.R2_BUCKET ?? 'vantly-ugc',
      publicUrl: process.env.R2_PUBLIC_URL ?? 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev',
    };
    if (!r2cfg.accessKeyId || !r2cfg.secretAccessKey) throw new Error('R2 credentials not set — cannot host the reference image for Evolink to fetch');
    const upload = await r2UploadVnext(r2cfg, 'storybook-probe', 'character-fox.png', foxBytes, 'image/png');
    console.log(`Uploaded reference image -> ${upload.publicUrl}`);
    const { videoUrl, taskId } = await generateSimpleSelfieEvolink({
      prompt:
        'The cartoon fox character in the reference image speaks directly to camera in the SAME flat vector cartoon art style — do not shift toward photorealism or 3D rendering. It says, in a warm friendly voice: "Once upon a time, in a cozy little burrow, there lived a curious fox named Pip." Natural cartoon mouth movement synced to the speech, simple flat-color background, bold clean outlines preserved throughout.',
      imageUrls: [upload.publicUrl],
      duration: 5,
      aspectRatio: '9:16',
      generateAudio: true,
      quality: '720p',
    });
    console.log(`OK -> taskId=${taskId}`);
    console.log(`VIDEO URL (open this and judge by eye: did it stay cartoon-styled, or drift photoreal?):`);
    console.log(videoUrl);
    results['seedance-style-test'] = 'OK';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAILED: ${msg}`);
    results['seedance-style-test'] = `FAILED:${msg.slice(0, 200)}`;
  }

  console.log('\n=== SUMMARY (final) ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
