// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Video Generation Flow audit, §6 improvement #9: "Turn the failure-message
 * quality work into a standing rule, not a one-off fix. failureInfo() fixed
 * one instance of 'WORKFLOW_FAILED / no message'; the pattern was already
 * flagged by a code comment as recurring. Add a lint/test rule (or a shared
 * wrapper every workflow catch block must use) that makes it structurally
 * hard to swallow a real ApplicationFailure.cause behind a generic message
 * again."
 *
 * Every workflow's top-level catch today (make-ugc-video.ts, broll-talking-
 * head.ts, make-podcast.ts, make-storybook.ts, and every single-primitive
 * workflow) already calls failureInfo(err) to unwrap Temporal's
 * ActivityFailure and get at the real err.cause -- see failure-info.ts's own
 * header comment for why err.message alone is always the useless literal
 * "Activity task failed". This test is the guardrail: it fails CI the
 * moment a NEW workflow file adds a catch block that reports a failure
 * (writes an error_code/error_message somewhere) without going through
 * failureInfo -- the exact regression class #9 is asking to prevent, not a
 * fix for a currently-broken file (every file below currently passes).
 *
 * File-level, not catch-block-level (same granularity declared-deps.test.ts
 * already uses for its own structural check) -- confirmed by inspection
 * that every workflow file has at most ONE catch block today, so this loses
 * no precision in practice: "this file has a catch but never calls
 * failureInfo anywhere in it" is exactly the WORKFLOW_FAILED/no-message bug
 * this rule exists to catch.
 *
 * A workflow file with NO catch block at all (portrait-gpt2.ts) is fine and
 * exempt: it doesn't swallow anything, it just propagates the raw error to
 * whichever composed-skill workflow calls it as a sub-step -- that PARENT
 * workflow's own catch (e.g. make-ugc-video.ts's) is what calls
 * failureInfo() for it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(here, '..', 'workflows');

// Files that are exempt by construction: the helper itself, and the
// barrel file (no workflow logic/catch blocks of its own).
const EXEMPT_FILES = new Set(['failure-info.ts', 'index.ts']);

function workflowSourceFiles(): string[] {
  return readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .filter((f) => !EXEMPT_FILES.has(f));
}

describe('every workflow catch block goes through failureInfo()', () => {
  it('a workflow file with a catch block also calls failureInfo(...) somewhere in it', () => {
    const offenders: string[] = [];
    for (const file of workflowSourceFiles()) {
      const src = readFileSync(join(workflowsDir, file), 'utf8');
      const hasCatchBlock = /\bcatch\s*\(/.test(src);
      const usesFailureInfo = /\bfailureInfo\s*\(/.test(src);
      if (hasCatchBlock && !usesFailureInfo) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `These workflow files catch an error without calling failureInfo(err) to unwrap it -- ` +
        `they will report the useless generic "Activity task failed" instead of the real ` +
        `ApplicationFailure.cause (e.g. INSUFFICIENT_CREDITS, EVOLINK_422). Import failureInfo ` +
        `from './failure-info.js' and use it in the catch block:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('sanity check: the workflows directory actually has catch blocks to guard (this test isn\'t vacuous)', () => {
    const withCatch = workflowSourceFiles().filter((f) =>
      /\bcatch\s*\(/.test(readFileSync(join(workflowsDir, f), 'utf8')),
    );
    expect(withCatch.length).toBeGreaterThan(0);
  });
});
