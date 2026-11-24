// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * One voice-block generation, shared by POST /v1/studio/tts (editor) and the
 * automation step (/internal/studio/automate-step):
 *
 *   key        platform key, the user's own key, or the workspace's shared key
 *   consent    cloned / professional voices need a consent record
 *   dictionary the project's pronunciation rules → cached ElevenLabs dictionary
 *   budget     workspace monthly budget + per-member cap
 *   billing    platform key only; refunded if ElevenLabs or storage fails
 *   storage    audio saved in the project's data region
 */

import { createHash, randomUUID } from 'node:crypto';
import { quoteVoiceoverTtsCredits, type StudioTtsRequest, type VoiceoverPronunciation } from '@vantly-ugc/schema';
import { supabase } from '../server.js';
import {
  ElevenLabsHttpError,
  ensurePronunciationDictionary,
  getElevenLabsVoice,
  platformElevenLabsKey,
  synthesizeElevenLabsWithTimestamps,
  type TimedWord,
} from './elevenlabs.js';
import { getUserProviderKey, getWorkspaceProviderKey } from './provider-keys.js';
import { putStudioObject } from './studio-storage.js';
import { StudioError, assertBudget, type ProjectRow, type Workspace } from './studio-access.js';

export interface SpeechResult {
  take_id: string;
  audio_url: string;
  audio_duration: number;
  words: TimedWord[];
  credits_deducted: number;
  voice_source: StudioTtsRequest['voice_source'];
  consent_id: string | null;
}

export async function resolveVoiceKey(
  userId: string,
  source: StudioTtsRequest['voice_source'],
  ws: Workspace | null,
): Promise<{ key: string; fingerprint: string }> {
  let key: string | null = null;
  if (source === 'user') {
    key = (await getUserProviderKey(userId, 'elevenlabs'))?.key ?? null;
    if (!key) throw new StudioError(400, 'NO_USER_KEY', 'Add your ElevenLabs API key in Studio settings to use your own voices.');
  } else if (source === 'workspace') {
    if (!ws) throw new StudioError(400, 'NO_WORKSPACE', 'Workspace voices are only available in workspace projects.');
    key = (await getWorkspaceProviderKey(ws.id, 'elevenlabs'))?.key ?? null;
    if (!key) throw new StudioError(400, 'NO_WORKSPACE_KEY', `${ws.name} has no shared ElevenLabs key yet. Ask an admin to add one.`);
  } else {
    key = platformElevenLabsKey();
    if (!key) throw new StudioError(503, 'NOT_CONFIGURED', 'Voiceover is not set up on this server. Add your own ElevenLabs key instead.');
  }
  return { key, fingerprint: createHash('sha256').update(key).digest('hex').slice(0, 24) };
}

const CLONE_CATEGORIES = new Set(['cloned', 'professional', 'generated']);

/**
 * Cloned voices need a recorded consent: in a workspace when the policy says
 * so (default on), and always for a personal clone (one-time self-attestation).
 */
export async function requireConsent(
  userId: string,
  ws: Workspace | null,
  source: StudioTtsRequest['voice_source'],
  key: string,
  voiceId: string,
): Promise<string | null> {
  if (source === 'platform') return null;
  if (ws && !ws.settings.require_voice_consent) return null;
  const voice = await getElevenLabsVoice(key, voiceId).catch(() => null);
  if (!voice || !CLONE_CATEGORIES.has(voice.category ?? '')) return null;
  let q = supabase.from('voice_consents').select('id').eq('voice_id', voiceId).is('revoked_at', null).limit(1);
  q = ws ? q.eq('workspace_id', ws.id) : q.is('workspace_id', null).eq('attested_by', userId);
  const { data } = await q;
  if (data?.length) return data[0].id as string;
  throw new StudioError(403, 'CONSENT_REQUIRED', `"${voice.name}" is a cloned voice. Record the speaker's consent before using it.`, {
    voice_id: voiceId,
    voice_name: voice.name,
  });
}

export async function generateSpeech(args: {
  userId: string;
  project: ProjectRow;
  ws: Workspace | null;
  req: StudioTtsRequest;
  chargeCredits: boolean;
}): Promise<SpeechResult> {
  const { userId, project, ws, req: t } = args;
  const { key, fingerprint } = await resolveVoiceKey(userId, t.voice_source, ws);
  const consentId = await requireConsent(userId, ws, t.voice_source, key, t.voice_id);

  const chars = t.text.length;
  const credits = t.voice_source === 'platform' && args.chargeCredits ? quoteVoiceoverTtsCredits(chars) : 0;
  await assertBudget(ws, userId, credits);

  const takeId = randomUUID();
  const { error: insErr } = await supabase.from('voiceover_tts_takes').insert({
    id: takeId,
    user_id: userId,
    project_id: project.id,
    workspace_id: ws?.id ?? null,
    block_id: t.block_id,
    key_source: t.voice_source,
    voice_id: t.voice_id,
    model_id: t.model_id,
    chars,
    credits_deducted: credits,
    status: 'submitted',
  });
  if (insErr) throw new StudioError(500, 'DATABASE_ERROR', insErr.message);

  if (credits > 0) {
    const { error } = await supabase.rpc('deduct_credits', { p_user_id: userId, p_amount: credits, p_job_id: takeId, p_description: `Voiceover TTS · ${chars} chars` });
    if (error) {
      await supabase.from('voiceover_tts_takes').update({ status: 'failed', credits_deducted: 0, error_message: error.message }).eq('id', takeId);
      const insufficient = /INSUFFICIENT|balance|USER_NOT_FOUND/i.test(error.message ?? '');
      throw new StudioError(insufficient ? 402 : 500, insufficient ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED', insufficient ? `This needs ${credits} credits.` : 'Credit deduction failed');
    }
  }

  const fail = async (status: number, code: string, message: string): Promise<never> => {
    if (credits > 0) await supabase.rpc('refund_credits', { p_job_id: takeId });
    await supabase.from('voiceover_tts_takes').update({ status: 'failed', error_message: message.slice(0, 500) }).eq('id', takeId);
    throw new StudioError(status, code, message);
  };

  // Pronunciation dictionary (cached per ElevenLabs account + rule set).
  const rules = ((project.timeline?.pronunciations ?? []) as VoiceoverPronunciation[]).filter((r) => r.word && (r.alias || r.phoneme));
  let dictionaries: Array<{ pronunciation_dictionary_id: string; version_id: string }> | undefined;
  if (rules.length) {
    try {
      dictionaries = [await ensurePronunciationDictionary(key, fingerprint, rules)];
    } catch (err) {
      console.warn(`[studio/tts] pronunciation dictionary skipped: ${(err as Error).message}`);
    }
  }

  let speech;
  try {
    speech = await synthesizeElevenLabsWithTimestamps(key, {
      voiceId: t.voice_id,
      text: t.text,
      modelId: t.model_id,
      settings: t.settings,
      previousText: t.model_id.includes('v3') ? undefined : t.previous_text,
      nextText: t.model_id.includes('v3') ? undefined : t.next_text,
      languageCode: t.language_code,
      dictionaries,
    });
  } catch (err) {
    const status = err instanceof ElevenLabsHttpError ? err.status : 0;
    if (status === 401 && t.voice_source !== 'platform') return fail(400, 'KEY_REJECTED', 'ElevenLabs rejected this API key.');
    if (status === 400 || status === 422) return fail(400, 'TTS_REJECTED', (err as Error).message);
    if (status === 429) return fail(429, 'TTS_RATE_LIMITED', 'ElevenLabs is rate-limiting this account. Try again in a moment.');
    console.error(`[studio/tts] ${takeId} failed: ${(err as Error).message}`);
    return fail(502, 'TTS_FAILED', 'ElevenLabs could not generate this block. Try again.');
  }

  let uploaded;
  try {
    uploaded = await putStudioObject(project.storage_region, `studio/tts/${userId}/${takeId}.mp3`, speech.audio, 'audio/mpeg');
  } catch (err) {
    return fail(500, 'STORAGE_FAILED', (err as Error).message);
  }
  await supabase.from('voiceover_tts_takes').update({ status: 'succeeded', audio_url: uploaded.url, audio_duration: speech.duration }).eq('id', takeId);

  return {
    take_id: takeId,
    audio_url: uploaded.url,
    audio_duration: speech.duration,
    words: speech.words,
    credits_deducted: credits,
    voice_source: t.voice_source,
    consent_id: consentId,
  };
}
