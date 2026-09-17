// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * OpenAI Whisper transcription helper. Returns word-level timestamps
 * suitable for ASS subtitle generation.
 *
 * Milestone 1, item 2 (Video Generation Flow audit): this was the one
 * external AI call in primitive-worker-vnext/src/client/ with literally no
 * bound on the upstream request -- every other client in this directory
 * (anthropic.ts, openai.ts, byteplus.ts, evolink.ts) sets an explicit
 * timeout. A hung connection here would only ever be caught by the
 * subtitles activity's Temporal heartbeatTimeout (90s, see
 * workflows/make-ugc-video.ts), which reaps it eventually but reports a
 * generic activity-timeout rather than a clearly attributable one. Added
 * WHISPER_TIMEOUT_MS so a hung request fails fast with a real cause, the
 * same treatment assist.ts's UPSTREAM_TIMEOUT classification already gets.
 * No cross-provider fallback added here (unlike assist.ts) -- this call
 * already runs inside a Temporal activity with 3 retries + backoff
 * (make-ugc-video.ts's `subtitles` proxyActivities config), which is real
 * redundancy assist.ts's plain HTTP route never had.
 */

import { readFile } from 'node:fs/promises';

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

const WHISPER_TIMEOUT_MS = 60_000;

export async function transcribeWithWhisper(
  apiKey: string,
  audioPath: string,
  language?: string,
): Promise<WhisperWord[]> {
  const bytes = await readFile(audioPath);
  // Node 22 has global FormData + Blob.
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)]), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  let resp: globalThis.Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      const timeoutErr = new Error(`whisper: transcription took too long (over ${WHISPER_TIMEOUT_MS / 1000}s)`);
      (timeoutErr as any).status = 504;
      throw timeoutErr;
    }
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`whisper ${resp.status}: ${text.slice(0, 400)}`);
    (err as any).status = resp.status;
    throw err;
  }
  const json = (await resp.json()) as { words?: WhisperWord[]; segments?: unknown[] };
  return (json.words ?? []).map((w) => ({
    word: String(w.word ?? ''),
    start: Number(w.start ?? 0),
    end: Number(w.end ?? 0),
  })).filter((w) => w.word.length > 0 && w.end > w.start);
}
