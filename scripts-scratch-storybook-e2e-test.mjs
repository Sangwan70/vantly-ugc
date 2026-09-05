// DISPOSABLE e2e test — not part of the pipeline, not committed.
//
// Exercises make_storybook end-to-end against a LOCAL docker-compose stack
// (`docker compose --env-file .env.local up -d --build`): signs up a fresh
// throwaway test user against local GoTrue (autoconfirm is on locally, so no
// email step), submits a small 2-scene storybook run, then polls until it
// finishes and prints the result.
//
// Usage:  node scripts-scratch-storybook-e2e-test.mjs
// Env:    reads SUPABASE_ANON_KEY from .env.local automatically.

import { readFileSync } from 'node:fs';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8000';
const API_URL = process.env.API_URL || 'http://localhost:3001';

function loadAnonKeyFromEnvLocal() {
  const raw = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
  const m = raw.match(/^SUPABASE_ANON_KEY=(.+)$/m);
  if (!m) throw new Error('SUPABASE_ANON_KEY not found in .env.local');
  return m[1].trim();
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY || loadAnonKeyFromEnvLocal();
  const email = `storybook-test-${Date.now()}@example.com`;
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`;

  console.log(`=== signing up ${email} against ${GATEWAY_URL} ===`);
  const signupResp = await fetch(`${GATEWAY_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  const signupJson = await signupResp.json();
  if (!signupResp.ok) {
    console.error('signup FAILED', signupResp.status, signupJson);
    process.exit(1);
  }
  const accessToken = signupJson.access_token;
  if (!accessToken) {
    console.error('signup succeeded but no access_token in response:', signupJson);
    process.exit(1);
  }
  console.log(`OK — user_id=${signupJson.user?.id}`);

  const payload = {
    title: 'Pip Finds a Door',
    characters: [
      { name: 'Pip', description: 'a small curious fox cub with orange fur, big eyes, and a blue scarf' },
    ],
    art_style: 'flat_vector_cartoon',
    scenes: [
      {
        speaker: 'Pip',
        line: 'Once upon a time, in a cozy little burrow, there lived a curious fox named Pip.',
        visual_description: 'standing in a sunny meadow, looking curious and friendly, waving hello',
      },
      {
        speaker: 'Pip',
        line: 'One day Pip found a strange glowing door hidden behind an old oak tree.',
        visual_description: 'standing in front of a mysterious glowing wooden door in a forest, looking amazed and excited',
      },
    ],
    aspect_ratio: '9:16',
    subtitles: false,
  };

  console.log('\n=== submitting make_storybook run ===');
  const runResp = await fetch(`${API_URL}/v1/skills/make_storybook/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const runJson = await runResp.json();
  if (!runResp.ok) {
    console.error('run submit FAILED', runResp.status, JSON.stringify(runJson, null, 2));
    process.exit(1);
  }
  console.log('OK ->', JSON.stringify(runJson, null, 2));
  const skillRunId = runJson.skill_run_id;
  if (!skillRunId) {
    console.error('no skill_run_id in response — cannot poll');
    process.exit(1);
  }

  console.log(`\n=== polling /v1/skills/runs/${skillRunId} (this can take several minutes) ===`);
  const start = Date.now();
  const TIMEOUT_MS = 25 * 60_000;
  let lastStep = '';
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 10_000));
    const pollResp = await fetch(`${API_URL}/v1/skills/runs/${skillRunId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const pollJson = await pollResp.json();
    if (!pollResp.ok) {
      console.error('poll FAILED', pollResp.status, pollJson);
      process.exit(1);
    }
    const step = `${pollJson.status}${pollJson.current_step ? ` (${pollJson.current_step})` : ''}`;
    if (step !== lastStep) {
      console.log(`[${Math.round((Date.now() - start) / 1000)}s] ${step}`);
      lastStep = step;
    }
    if (pollJson.status === 'succeeded') {
      console.log('\n=== SUCCEEDED ===');
      console.log(JSON.stringify(pollJson, null, 2));
      return;
    }
    if (pollJson.status === 'failed') {
      console.log('\n=== FAILED ===');
      console.log(JSON.stringify(pollJson, null, 2));
      process.exit(1);
    }
  }
  console.error('\n=== TIMED OUT waiting for the run to finish ===');
  process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
