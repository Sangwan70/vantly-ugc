// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { proxyActivities } from '@temporalio/workflow';
import type { PrimitiveActivities } from '../activities/index.js';
import { failureInfo } from './failure-info.js';
import type {
  VoiceoverRenderActivityInput,
  VoiceoverRenderActivityResult,
} from '../activities/voiceover-render.js';

const { voiceoverRender } = proxyActivities<PrimitiveActivities>({
  // Long screen recordings render for a while; the activity heartbeats per
  // segment and every few seconds of the final pass.
  startToCloseTimeout: '120 minutes',
  heartbeatTimeout: '3 minutes',
  retry: {
    initialInterval: '10s',
    maximumInterval: '60s',
    backoffCoefficient: 2,
    maximumAttempts: 2,
    nonRetryableErrorTypes: [
      'INVALID_INPUT',
      'REFERENCE_FETCH_FAILED',
      'REFERENCE_NOT_VIDEO',
      'REFERENCE_TOO_LARGE',
      'REFERENCE_URL_NOT_ALLOWED',
      'INSUFFICIENT_CREDITS',
    ],
  },
});

const { refundCredits, markPrimitiveRunFailed } = proxyActivities<PrimitiveActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2s', maximumInterval: '20s', backoffCoefficient: 2, maximumAttempts: 5 },
});

export async function voiceoverRenderWorkflow(
  input: VoiceoverRenderActivityInput,
): Promise<VoiceoverRenderActivityResult> {
  try {
    return await voiceoverRender(input);
  } catch (err) {
    await refundCredits({ primitive_run_id: input.primitive_run_id });
    const f = failureInfo(err);
    await markPrimitiveRunFailed({ primitive_run_id: input.primitive_run_id, error_code: f.code, error_message: f.message });
    throw err;
  }
}
