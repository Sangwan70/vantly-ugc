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

// ── Voiceover Studio: key-aware calls ──────────────────────────────────────
// The functions below take the API key explicitly so the same code serves
// the platform key (ELEVENLABS_API_KEY) and a user's own key (see
// lib/provider-keys.ts). The functions above are left untouched for the
// make_ugc "Voice Actor" path.

export class ElevenLabsHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ElevenLabsHttpError';
  }
}

export function platformElevenLabsKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export async function listElevenLabsVoicesWithKey(key: string): Promise<ElevenLabsVoice[]> {
  const resp = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new ElevenLabsHttpError(resp.status, `elevenlabs: list voices failed (${resp.status})`);
  const data = (await resp.json().catch(() => null)) as { voices?: Array<Record<string, unknown>> } | null;
  return (data?.voices ?? []).map((v) => ({
    voice_id: String(v.voice_id),
    name: String(v.name ?? v.voice_id),
    preview_url: typeof v.preview_url === 'string' ? v.preview_url : null,
    category: typeof v.category === 'string' ? v.category : undefined,
    labels: v.labels && typeof v.labels === 'object' ? (v.labels as Record<string, string>) : undefined,
  }));
}

export interface ElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  max_characters?: number;
  languages?: string[];
}

export async function listElevenLabsModels(key: string): Promise<ElevenLabsModel[]> {
  const resp = await fetch(`${ELEVENLABS_API_BASE}/models`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new ElevenLabsHttpError(resp.status, `elevenlabs: list models failed (${resp.status})`);
  const data = (await resp.json().catch(() => [])) as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : [])
    .filter((m) => m.can_do_text_to_speech !== false)
    .map((m) => ({
      model_id: String(m.model_id),
      name: String(m.name ?? m.model_id),
      description: typeof m.description === 'string' ? m.description : undefined,
      max_characters:
        typeof m.maximum_text_length_per_request === 'number' ? m.maximum_text_length_per_request : undefined,
      languages: Array.isArray(m.languages)
        ? (m.languages as Array<Record<string, unknown>>).map((l) => String(l.language_id ?? l.name ?? '')).filter(Boolean)
        : undefined,
    }));
}

/** Verify a key works (used before saving a user's key). */
export async function verifyElevenLabsKey(key: string): Promise<boolean> {
  const resp = await fetch(`${ELEVENLABS_API_BASE}/voices?page_size=1`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(resp?.ok);
}

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

/** Fold ElevenLabs character alignment into word timings. */
export function alignmentToWords(alignment: {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
} | null | undefined): TimedWord[] {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words: TimedWord[] = [];
  let cur = '';
  let curStart = 0;
  let curEnd = 0;
  let inTag = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    // SSML-style tags (<break time="0.5s" />) are directions, not spoken words.
    if (ch === '<') { inTag = true; continue; }
    if (inTag) { if (ch === '>') inTag = false; continue; }
    if (/\s/.test(ch)) {
      if (cur) words.push({ word: cur, start: curStart, end: curEnd });
      cur = '';
      continue;
    }
    if (!cur) curStart = starts[i] ?? curEnd;
    cur += ch;
    curEnd = ends[i] ?? curEnd;
  }
  if (cur) words.push({ word: cur, start: curStart, end: curEnd });
  // eleven_v3 audio tags like [excited] are spoken as direction, not words.
  return words.filter((w) => !/^\[[^\]]*\]$/.test(w.word));
}

export interface TimedSpeech {
  audio: Buffer;
  words: TimedWord[];
  duration: number;
  requestId: string | null;
}

export async function synthesizeElevenLabsWithTimestamps(
  key: string,
  args: {
    voiceId: string;
    text: string;
    modelId: string;
    settings: {
      stability: number;
      similarity_boost: number;
      style: number;
      use_speaker_boost: boolean;
      speed: number;
    };
    previousText?: string;
    nextText?: string;
    languageCode?: string;
    dictionaries?: Array<{ pronunciation_dictionary_id: string; version_id: string }>;
  },
): Promise<TimedSpeech> {
  const body: Record<string, unknown> = {
    text: args.text,
    model_id: args.modelId,
    voice_settings: args.settings,
  };
  if (args.previousText) body.previous_text = args.previousText;
  if (args.nextText) body.next_text = args.nextText;
  if (args.languageCode) body.language_code = args.languageCode;
  if (args.dictionaries?.length) body.pronunciation_dictionary_locators = args.dictionaries;

  const url = `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(args.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    let message = detail.slice(0, 300);
    try {
      const j = JSON.parse(detail) as { detail?: { message?: string } | string };
      message = typeof j.detail === 'string' ? j.detail : j.detail?.message ?? message;
    } catch { /* keep raw */ }
    throw new ElevenLabsHttpError(resp.status, `ElevenLabs (${resp.status}): ${message}`);
  }
  const data = (await resp.json()) as {
    audio_base64?: string;
    alignment?: Parameters<typeof alignmentToWords>[0];
    normalized_alignment?: Parameters<typeof alignmentToWords>[0];
  };
  if (!data.audio_base64) throw new ElevenLabsHttpError(502, 'ElevenLabs returned no audio');
  const audio = Buffer.from(data.audio_base64, 'base64');
  const words = alignmentToWords(data.alignment ?? data.normalized_alignment);
  const ends = data.alignment?.character_end_times_seconds ?? data.normalized_alignment?.character_end_times_seconds ?? [];
  // mp3 frames add a little tail after the last aligned character.
  const duration = ends.length ? Math.max(...ends) + 0.15 : estimateMp3Duration(audio);
  return { audio, words, duration, requestId: resp.headers.get('request-id') };
}

/** CBR fallback when alignment is missing: 128 kbps → 16 000 bytes/s. */
function estimateMp3Duration(buf: Buffer): number {
  return buf.byteLength / 16_000;
}

// ── Voice lookup + pronunciation dictionaries ──────────────────────────────

const voiceCache = new Map<string, { at: number; voice: ElevenLabsVoice }>();

export async function getElevenLabsVoice(key: string, voiceId: string): Promise<ElevenLabsVoice> {
  const ck = `${key.slice(-8)}:${voiceId}`;
  const hit = voiceCache.get(ck);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.voice;
  const resp = await fetch(`${ELEVENLABS_API_BASE}/voices/${encodeURIComponent(voiceId)}`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new ElevenLabsHttpError(resp.status, `elevenlabs: get voice failed (${resp.status})`);
  const v = (await resp.json()) as Record<string, unknown>;
  const voice: ElevenLabsVoice = {
    voice_id: String(v.voice_id ?? voiceId),
    name: String(v.name ?? voiceId),
    preview_url: typeof v.preview_url === 'string' ? v.preview_url : null,
    category: typeof v.category === 'string' ? v.category : undefined,
  };
  voiceCache.set(ck, { at: Date.now(), voice });
  return voice;
}

/**
 * Get (or create once) an ElevenLabs pronunciation dictionary for a rule set,
 * cached in voiceover_pron_dicts per ElevenLabs account (key fingerprint).
 */
export async function ensurePronunciationDictionary(
  key: string,
  fingerprint: string,
  rules: Array<{ word: string; alias: string; phoneme: string }>,
): Promise<{ pronunciation_dictionary_id: string; version_id: string }> {
  const { createHash } = await import('node:crypto');
  const { supabase } = await import('../server.js');
  const normalized = rules
    .map((r) => ({ word: r.word.trim(), alias: r.alias.trim(), phoneme: r.phoneme.trim() }))
    .sort((a, b) => a.word.localeCompare(b.word));
  const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
  const { data: cached } = await supabase
    .from('voiceover_pron_dicts')
    .select('dictionary_id, version_id')
    .eq('key_fingerprint', fingerprint)
    .eq('rules_hash', hash)
    .maybeSingle();
  if (cached) return { pronunciation_dictionary_id: cached.dictionary_id as string, version_id: cached.version_id as string };

  const body = {
    name: `vantly-studio-${hash.slice(0, 12)}`,
    rules: normalized.map((r) =>
      r.phoneme
        ? { type: 'phoneme', string_to_replace: r.word, phoneme: r.phoneme, alphabet: 'ipa' }
        : { type: 'alias', string_to_replace: r.word, alias: r.alias },
    ),
  };
  const resp = await fetch(`${ELEVENLABS_API_BASE}/pronunciation-dictionaries/add-from-rules`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new ElevenLabsHttpError(resp.status, `elevenlabs: create dictionary failed (${resp.status}) ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  const j = (await resp.json()) as { id: string; version_id: string };
  await supabase.from('voiceover_pron_dicts').upsert({ key_fingerprint: fingerprint, rules_hash: hash, dictionary_id: j.id, version_id: j.version_id }, { onConflict: 'key_fingerprint,rules_hash' });
  return { pronunciation_dictionary_id: j.id, version_id: j.version_id };
}
