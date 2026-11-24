// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceoverAutomateStep — asks api-v2 to assemble an automated project's
 * timeline (generate every voice block with ElevenLabs, apply smart-edit
 * suggestions and the template, auto-space) and returns the render input.
 *
 * TTS stays in api-v2 on purpose: that is where provider keys (platform and
 * users' encrypted keys), pronunciation dictionaries, consent checks and TTS
 * billing live. The worker never sees a user's ElevenLabs key.
 */

import { ApplicationFailure } from '@temporalio/activity';
import type { WorkerConfig } from '../config.js';

export interface VoiceoverAutomateStepInput {
  primitive_run_id: string;
  project_id: string;
  user_id: string;
}

export function makeVoiceoverAutomateStepActivity(cfg: WorkerConfig) {
  return async function voiceoverAutomateStep(input: VoiceoverAutomateStepInput): Promise<unknown> {
    const base = cfg.openai.imageProxyUrl.replace(/\/+$/, '');
    const resp = await fetch(`${base}/internal/studio/automate-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': cfg.openai.imageProxySecret },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(29 * 60_000),
    });
    const body = (await resp.json().catch(() => null)) as { render_input?: unknown; error?: { code?: string; message?: string } } | null;
    if (resp.status >= 500 || resp.status === 429) throw new Error(`automate-step transient ${resp.status}: ${body?.error?.message ?? ''}`);
    if (!resp.ok || !body?.render_input) {
      const code = body?.error?.code === 'INSUFFICIENT_CREDITS' ? 'INSUFFICIENT_CREDITS' : 'AUTOMATE_REJECTED';
      throw ApplicationFailure.nonRetryable(body?.error?.message ?? `automate-step failed (${resp.status})`, code);
    }
    return body.render_input;
  };
}
