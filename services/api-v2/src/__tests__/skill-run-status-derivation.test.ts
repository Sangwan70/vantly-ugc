// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Unit tests for deriveEffectiveSkillRunStatus (routes/v1/skills.ts), the
 * fix for the run-status-disagreement bug: the run-detail page showing
 * "running"/"submitted" while a child step had already failed, because the
 * parent skill_runs row only flips to 'failed' once the workflow's own
 * catch handler runs or the (separately fixed) reconciler sweeps it -- up
 * to 50 minutes later. See incident 6b761625 / 11b7295d in
 * orchestrator/temporal/config.ts and skill-reconciler.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveEffectiveSkillRunStatus,
  type SkillRunParentForStatus,
  type SkillRunStepForStatus,
} from '../lib/skill-run-status.js';

function parent(overrides: Partial<SkillRunParentForStatus> = {}): SkillRunParentForStatus {
  return { status: 'running', error_code: null, error_message: null, ...overrides };
}

function step(overrides: Partial<SkillRunStepForStatus> = {}): SkillRunStepForStatus {
  return {
    status: 'succeeded',
    primitive_id: 'simple_selfie',
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

describe('deriveEffectiveSkillRunStatus', () => {
  it('reports failed immediately when a step has failed but the parent is still running', () => {
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'running' }), [
      step({ primitive_id: 'portrait_gpt2', status: 'succeeded' }),
      step({ primitive_id: 'simple_selfie', status: 'failed', error_code: 'BUDGET_CAP_PRIMITIVE', error_message: 'cap exceeded' }),
    ]);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ code: 'BUDGET_CAP_PRIMITIVE', message: 'cap exceeded' });
  });

  it('reports failed immediately when the parent is still submitted (never dispatched)', () => {
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'submitted' }), [
      step({ primitive_id: 'portrait_gpt2', status: 'failed', error_code: null, error_message: null }),
    ]);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ code: 'STEP_FAILED', message: 'Step "portrait_gpt2" failed.' });
  });

  it('falls back to a generic message only when the failed step has none', () => {
    const result = deriveEffectiveSkillRunStatus(parent(), [
      step({ primitive_id: 'watermark', status: 'failed', error_code: 'X', error_message: '' }),
    ]);
    expect(result.error).toEqual({ code: 'X', message: 'Step "watermark" failed.' });
  });

  it('passes through the parent status untouched when no step has failed', () => {
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'running' }), [
      step({ status: 'succeeded' }),
      step({ status: 'running', primitive_id: 'subtitles' }),
    ]);
    expect(result.status).toBe('running');
    expect(result.error).toBeNull();
  });

  it('does not override an already-terminal parent status with a failed step (retry-safe)', () => {
    // If the run already succeeded/canceled, a stray 'failed' step row (e.g.
    // from an earlier attempt in a workflow that itself retried and moved
    // past it) must never flip an otherwise-terminal, non-failed run back to
    // failed.
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'succeeded' }), [
      step({ status: 'failed', primitive_id: 'subtitles' }),
    ]);
    expect(result.status).toBe('succeeded');
  });

  it('prefers the run-level error over a derived step error once the parent is terminal-failed', () => {
    const result = deriveEffectiveSkillRunStatus(
      parent({ status: 'failed', error_code: 'WORKFLOW_ERROR', error_message: 'workflow-level message' }),
      [step({ status: 'failed', primitive_id: 'subtitles', error_code: 'STEP_X', error_message: 'step-level message' })],
    );
    expect(result.error).toEqual({ code: 'WORKFLOW_ERROR', message: 'workflow-level message' });
  });

  it('treats canceled as terminal and does not surface a failed step under it', () => {
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'canceled' }), [
      step({ status: 'failed', primitive_id: 'subtitles' }),
    ]);
    expect(result.status).toBe('canceled');
    expect(result.error).toBeNull();
  });

  it('handles an empty step list without throwing', () => {
    const result = deriveEffectiveSkillRunStatus(parent({ status: 'submitted' }), []);
    expect(result.status).toBe('submitted');
    expect(result.error).toBeNull();
  });
});
