// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Mirrors services/primitive-worker-vnext/src/__tests__/openai-classify.test.ts
// for api-v2's independent classifyOpenAIError() (used by the internal
// /internal/gpt-image proxy route the worker falls back to). Both
// implementations must agree on what counts as a genuine content-policy
// rejection vs. an unrelated 4xx, since the worker trusts whichever path
// (direct or proxied) actually served the request.

import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { classifyOpenAIError } from '../lib/openai-image.js';

function makeApiError(status: number, error: Record<string, unknown> | undefined, message?: string) {
  return new OpenAI.APIError(status, error, message, undefined);
}

describe('classifyOpenAIError (api-v2)', () => {
  it('flags a genuine content-policy rejection via the real error code', () => {
    const err = makeApiError(400, {
      code: 'content_policy_violation',
      message: 'Your request was rejected by our safety system.',
    });
    const c = classifyOpenAIError(err);
    expect(c.retryable).toBe(false);
    expect(c.isContentPolicyViolation).toBe(true);
  });

  it('does NOT flag an unrelated 400 (bad parameter) as a content-policy violation', () => {
    const err = makeApiError(400, { code: 'invalid_size_parameter', message: 'size must be one of ...' });
    const c = classifyOpenAIError(err);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('does NOT flag a retryable (5xx) error', () => {
    const err = makeApiError(500, { message: 'internal error' });
    const c = classifyOpenAIError(err);
    expect(c.retryable).toBe(true);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('defaults to false for an unrecognized error shape', () => {
    const c = classifyOpenAIError(new Error('boom'));
    expect(c.isContentPolicyViolation).toBe(false);
  });
});
