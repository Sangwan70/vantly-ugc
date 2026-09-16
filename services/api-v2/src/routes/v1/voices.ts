// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /v1/voices/elevenlabs -- lists the ElevenLabs voices available to this
 * account, for the "Voice Actor" picker in the agent composer. Returns an
 * empty, `configured: false` payload (never a 500) when ELEVENLABS_API_KEY
 * isn't set, so the UI can render a plain "voiceover isn't set up" state
 * instead of erroring the whole page.
 */

import type { Request, Response } from 'express';
import { elevenLabsConfigured, listElevenLabsVoices } from '../../lib/elevenlabs.js';

export async function listElevenLabsVoicesRoute(_req: Request, res: Response): Promise<void> {
  if (!elevenLabsConfigured()) {
    res.status(200).json({ configured: false, voices: [] });
    return;
  }
  try {
    const voices = await listElevenLabsVoices();
    res.status(200).json({ configured: true, voices });
  } catch (err) {
    console.error(`[voices/elevenlabs] list failed: ${(err as Error).message}`);
    res.status(502).json({ configured: true, voices: [], error: { code: 'ELEVENLABS_UNAVAILABLE', message: 'Could not reach ElevenLabs.' } });
  }
}
