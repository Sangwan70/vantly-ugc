// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Regression test: classifyOpenAIError() must derive isContentPolicyViolation
// from the REAL OpenAI error code/type (or an unambiguous safety-system
// phrase), never from "this happened to be a 4xx" alone. Before this fix,
// portrait-gpt2.ts's friendly-message rewrite fired for ANY 400/403/422/451
// (a bad size, a bad param, a too-large payload -- none of them a content
// rejection) and mislabeled them all as "flagged by the image safety filter",
// which is exactly what a user reported for a benign podcast-guest
// description that had nothing to do with safety.

import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { classifyOpenAIError, ProxyImageError } from '../client/openai.js';

function makeApiError(status: number, error: Record<string, unknown> | undefined, message?: string) {
  return new OpenAI.APIError(status, error, message, undefined);
}

describe('classifyOpenAIError', () => {
  it('flags a genuine content-policy rejection via the real error code', () => {
    const err = makeApiError(400, {
      code: 'content_policy_violation',
      type: 'image_generation_user_error',
      message: 'Your request was rejected by our safety system.',
    });
    const c = classifyOpenAIError(err);
    expect(c.retryable).toBe(false);
    expect(c.isContentPolicyViolation).toBe(true);
  });

  it('flags a genuine content-policy rejection via the real error type when code is absent', () => {
    const err = makeApiError(403, { type: 'moderation_blocked', message: 'blocked' });
    const c = classifyOpenAIError(err);
    expect(c.isContentPolicyViolation).toBe(true);
  });

  it('falls back to a message-text heuristic when code/type are missing', () => {
    const err = makeApiError(400, undefined, 'rejected by our safety system');
    const c = classifyOpenAIError(err);
    expect(c.isContentPolicyViolation).toBe(true);
  });

  it('does NOT flag an unrelated 400 (bad parameter) as a content-policy violation', () => {
    const err = makeApiError(400, { code: 'invalid_size_parameter', message: 'size must be one of ...' });
    const c = classifyOpenAIError(err);
    expect(c.retryable).toBe(false);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('does NOT flag a 413/422 that is not content-related', () => {
    const err = makeApiError(422, { code: 'payload_too_large', message: 'image exceeds size limit' });
    const c = classifyOpenAIError(err);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('does NOT flag an auth error', () => {
    const err = makeApiError(401, { code: 'invalid_api_key', message: 'Incorrect API key provided' });
    const c = classifyOpenAIError(err);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('is never flagged for a retryable (5xx/transient) error', () => {
    const err = makeApiError(500, { message: 'internal error' });
    const c = classifyOpenAIError(err);
    expect(c.retryable).toBe(true);
    expect(c.isContentPolicyViolation).toBe(false);
  });

  it('passes the flag through unchanged from a ProxyImageError', () => {
    const proxyHit = new ProxyImageError('flagged', 'OPENAI_400', false, true);
    expect(classifyOpenAIError(proxyHit).isContentPolicyViolation).toBe(true);

    const proxyMiss = new ProxyImageError('bad size', 'OPENAI_400', false, false);
    expect(classifyOpenAIError(proxyMiss).isContentPolicyViolation).toBe(false);
  });

  it('defaults to false for an unrecognized error shape', () => {
    const c = classifyOpenAIError(new Error('boom'));
    expect(c.isContentPolicyViolation).toBe(false);
  });
});
