// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { proxyActivities } from '@temporalio/workflow';
import type { PrimitiveActivities } from '../activities/index.js';
import { failureInfo } from './failure-info.js';
import type { VoiceoverPrepareActivityInput } from '../activities/voiceover-prepare.js';
import type { VoiceoverAutomateStepInput } from '../activities/voiceover-automate.js';
import type { VoiceoverRenderActivityResult } from '../activities/voiceover-render.js';

const { voiceoverPrepare } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '60 minutes',
  heartbeatTimeout: '3 minutes',
  retry: {
    initialInterval: '10s',
    maximumInterval: '60s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['REFERENCE_FETCH_FAILED', 'REFERENCE_NOT_VIDEO', 'REFERENCE_URL_NOT_ALLOWED'],
  },
});

const { voiceoverAutomateStep } = proxyActivities<PrimitiveActivities>({
  // Generates every voice block through api-v2 (ElevenLabs), sequentially.
  startToCloseTimeout: '30 minutes',
  retry: { initialInterval: '10s', maximumInterval: '60s', backoffCoefficient: 2, maximumAttempts: 3, nonRetryableErrorTypes: ['AUTOMATE_REJECTED', 'INSUFFICIENT_CREDITS'] },
});

const { voiceoverRender } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '120 minutes',
  heartbeatTimeout: '3 minutes',
  retry: {
    initialInterval: '10s',
    maximumInterval: '60s',
    backoffCoefficient: 2,
    maximumAttempts: 2,
    nonRetryableErrorTypes: ['INVALID_INPUT', 'REFERENCE_FETCH_FAILED', 'REFERENCE_NOT_VIDEO', 'REFERENCE_TOO_LARGE', 'REFERENCE_URL_NOT_ALLOWED', 'INSUFFICIENT_CREDITS'],
  },
});

const { refundCredits, markPrimitiveRunFailed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

/** Proxy + filmstrip + smart-edit suggestions for a freshly uploaded recording. */
export async function voiceoverPrepareWorkflow(input: VoiceoverPrepareActivityInput): Promise<void> {
  await voiceoverPrepare(input);
}

/**
 * Hands-free: recording + script → finished video(s).
 * prepare → api-v2 builds the timeline (TTS every block, apply suggestions,
 * template, auto-space) → render.
 */
export async function voiceoverAutomateWorkflow(input: VoiceoverAutomateStepInput & VoiceoverPrepareActivityInput): Promise<VoiceoverRenderActivityResult> {
  try {
    await voiceoverPrepare({ project_id: input.project_id, user_id: input.user_id, source_url: input.source_url, storage_region: input.storage_region });
    const renderInput = await voiceoverAutomateStep(input);
    return await voiceoverRender({ primitive_run_id: input.primitive_run_id, user_id: input.user_id, input: renderInput });
  } catch (err) {
    await refundCredits({ primitive_run_id: input.primitive_run_id });
    const f = failureInfo(err);
    await markPrimitiveRunFailed({ primitive_run_id: input.primitive_run_id, error_code: f.code, error_message: f.message });
    throw err;
  }
}
