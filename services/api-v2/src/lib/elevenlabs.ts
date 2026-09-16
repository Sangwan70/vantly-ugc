// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Real ElevenLabs client: list available voices, and synthesize text into an
 * MP3 buffer via the text-to-speech endpoint.
 *
 * This is the first call in the codebase that actually invokes ElevenLabs'
 * text-to-speech endpoint. The pre-existing tooling/tool-registry.ts
 * `elevenlabs_audio` tool (a separate, unrelated MCP tool-composition
 * surface) only ever GETs /voices/:id to confirm a voice id exists -- it
 * never synthesizes audio or produces a playable file. This module is used
 * by the make_ugc "Voice Actor" feature: the synthesized clip becomes a
 * voice-timbre reference (voice_ref_audio_url) that Seedance uses to speak
 * the script in that voice, rather than a bring-your-own final audio track.
 */

const ELEVENLABS_API_BASE = process.env.ELEVENLABS_API_BASE?.trim() || 'https://api.elevenlabs.io/v1';

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
  return key;
}

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category?: string;
  labels?: Record<string, string>;
}

/** List voices available to this account (built-in + any cloned voices). */
export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  const resp = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(`elevenlabs: list voices failed (${resp.status})`);
  }
  const data = (await resp.json().catch(() => null)) as { voices?: Array<Record<string, unknown>> } | null;
  return (data?.voices ?? []).map((v) => ({
    voice_id: String(v.voice_id),
    name: String(v.name ?? v.voice_id),
    preview_url: typeof v.preview_url === 'string' ? v.preview_url : null,
    category: typeof v.category === 'string' ? v.category : undefined,
    labels: (v.labels && typeof v.labels === 'object' ? (v.labels as Record<string, string>) : undefined),
  }));
}

// A voice-timbre reference only needs a short sample, and ElevenLabs' own
// per-call limits make a long synthesis slow/expensive -- cap well below
// their hard character ceiling.
const MAX_TTS_CHARS = 2000;

/**
 * Synthesize `text` in the given voice. Returns raw MP3 bytes.
 * `languageCode` (BCP-47, e.g. "es", "hi") is passed through to
 * ElevenLabs' multilingual model when set, so the reference sample is
 * actually spoken in that language.
 */
export async function synthesizeElevenLabsSpeech(
  voiceId: string,
  text: string,
  opts?: { languageCode?: string; modelId?: string },
): Promise<Buffer> {
  const trimmed = text.trim().slice(0, MAX_TTS_CHARS);
  if (!trimmed) throw new Error('elevenlabs: text is empty');
  const body: Record<string, unknown> = {
    text: trimmed,
    model_id: opts?.modelId ?? 'eleven_multilingual_v2',
  };
  if (opts?.languageCode) body.language_code = opts.languageCode;

  const resp = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey(),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`elevenlabs: text-to-speech failed (${resp.status}) ${detail.slice(0, 200)}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
